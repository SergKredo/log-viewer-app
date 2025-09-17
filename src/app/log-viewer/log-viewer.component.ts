import { ChangeDetectorRef, Component, HostListener, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ScrollingModule } from '@angular/cdk/scrolling';

@Component({
  selector: 'app-log-viewer',
  templateUrl: './log-viewer.component.html',
  styleUrls: ['./log-viewer.component.css'],
  standalone: true,
  imports: [CommonModule, FormsModule, ScrollingModule]
})
export class LogViewerComponent {
  fileName = '';
  logs: string[] = [];
  filteredLogs: string[] = [];
  expandedLogs = new Map<number, boolean>();
  filterId = '';
  totalLogs = 0;
  highlightSignalR = false;
  highlightHub = false;
  filterSignalR = false;
  filterRequestResponse = false;
  profilerOnly = false; // new simple filter
  isLoading = false;
  // Analysis feature state (optional, toggled)
  showAnalysis = false;
  slowThreshold = 0.05; // seconds threshold for slow request
  aggregatedProfiles: { count: number; total: number; self: number; maxTotal: number; slowCount: number; } = { count: 0, total: 0, self: 0, maxTotal: 0, slowCount: 0 };
  // Slow only view
  slowOnly = false;
  displayedLogs: string[] = [];
  private slowGroupIndices = new Set<number>();
  private readonly profileStatsRegex = /\/api\/data[\t ]+POST\s+(\d+)\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/i;
  private readonly longExecRegex = /Too long execution/i;
  // Generic job pattern inside 'Too long execution' blocks: handles optional self time part
  // Examples:
  //   UpdateXsltJob	1	5.557 / 0.003 (5)
  //   KeepUpSsoConnectionJob	1	24.045 (10)
  // Captures: count, total, self? (optional)
  // General root line in 'Too long execution' block: optional leading dash/space/(!), captures name tokens ending before count
  // Examples:
  //   - (!)KeepUpSsoConnectionJob	1	24.045 (10)
  //   - SomeCustomCommand	1	1.234 / 0.100 (3)
  //   - DataSyncService.Process	2	3.210 / 1.500 (8)
  private readonly longExecJobRegex = /[-\s]*\(!\)?\s*([A-Za-z0-9_.]+(?:Job|Command|Service|Process|Task))\s+(\d+)\s+(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*\(\d+\)/;
  // Execution profile header
  private readonly executionProfileHeaderRegex = /Execution profile/i;
  // Generic root line immediately after Execution profile header e.g. '- EnvController.selectApp.atask\t1\t0.326 / 0.001'
  // Root line after 'Execution profile': count, total, optional '/ self', optional (N)
  private readonly executionRootLineRegex = /-\s+[^\t\n]+\t(\d+)\t(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?(?:\s*\(\d+\))?/;

  // Strict profiling token: '/api/data POST' (case-insensitive), allow variable whitespace (spaces or tabs) between parts
  private readonly profileLiteral = '/api/data POST';
  private readonly profileRegex = /\/api\/data[\t ]+POST/i;

  errorCodes: number[] = [100, 200, 300, 400, 500];
  selectedErrorCodes: number[] = [];
  dropdownOpen = false;

  constructor(private sanitizer: DomSanitizer, private cdr: ChangeDetectorRef, private zone: NgZone) {}

  loadFile(event: any): void {
    const file = event.target.files?.[0];
    if (!file) return;
    this.fileName = file.name;
    this.isLoading = true;
    const reader = new FileReader();
    reader.onload = (e: any) => {
      this.zone.run(() => {
        this.logs = (e.target.result as string).split('\n');
        this.filteredLogs = this.groupLogs(this.logs);
        this.totalLogs = this.filteredLogs.length;
        this.isLoading = false;
        this.cdr.detectChanges();
      });
    };
    reader.readAsText(file);
  }

  saveFilteredLogs(): void {
    const analysisActive = this.profilerOnly && this.showAnalysis;
    const linesToSave = analysisActive ? this.displayedLogs : this.filteredLogs;
    let header = '';
    if (analysisActive && this.aggregatedProfiles.count > 0) {
      const avgTotal = this.aggregatedProfiles.total / this.aggregatedProfiles.count;
      const avgSelf = this.aggregatedProfiles.self / this.aggregatedProfiles.count;
      const slowPct = this.aggregatedProfiles.count ? (this.aggregatedProfiles.slowCount / this.aggregatedProfiles.count * 100) : 0;
      const slowFlag = this.slowOnly ? 'true' : 'false';
      const separator = '============================================================';
      header = [
        separator,
        'PROFILING SUMMARY',
        separator,
        `Source File        : ${this.fileName || 'N/A'}`,
        `Threshold (s)      : ${this.slowThreshold}`,
        `Slow Only Mode     : ${slowFlag}`,
        '',
        `Requests           : ${this.aggregatedProfiles.count}`,
        `Avg Total (s)      : ${avgTotal.toFixed(3)}`,
        `Avg Self (s)       : ${avgSelf.toFixed(3)}`,
        `Max Total (s)      : ${this.aggregatedProfiles.maxTotal.toFixed(3)}`,
        `Slow (>=threshold) : ${this.aggregatedProfiles.slowCount}`,
        `Slow %             : ${slowPct.toFixed(1)}%`,
        separator,
        '',
        'FILTERED PROFILING LOG ENTRIES',''
      ].join('\n');
    }
    const content = header + linesToSave.join('\n');
    const base = this.fileName ? this.fileName.replace(/\.[^.]+$/, '') : 'logs';
    const suffix = analysisActive ? 'profiling' : 'filtered';
    const outName = `${base}-${suffix}.txt`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = outName; a.click();
    URL.revokeObjectURL(url);
  }

  filterLogs(): void {
    this.isLoading = true;
    let filtered = this.groupLogs(this.logs);
    if (this.filterId) {
      const idLower = this.filterId.toLowerCase();
      filtered = filtered.filter(g => g.toLowerCase().includes(idLower));
    }
    if (this.filterSignalR || this.highlightSignalR || this.highlightHub) {
      filtered = filtered.filter(group => group.split('\n').some(line => {
        const includesSignalR = line.includes('[SignalR]');
        const includesHub = line.includes('WebScapeHub');
        return (
          (this.filterSignalR && (includesSignalR || includesHub)) ||
          (this.highlightSignalR && includesSignalR) ||
          (this.highlightHub && includesHub)
        );
      }));
    }
    if (this.selectedErrorCodes.length) {
      filtered = filtered.filter(group => group.split('\n').some(line => this.selectedErrorCodes.some(code => this.isApacheHttpStatusInRange(line, code))));
    }
    if (this.filterRequestResponse) {
      filtered = this.filterRequestResponseLogs(filtered);
    }
    if (this.profilerOnly) {
      filtered = filtered.filter(g => g.split('\n').some(line => this.profileRegex.test(line) || this.longExecRegex.test(line) || this.executionProfileHeaderRegex.test(line)));
    }
    this.filteredLogs = filtered;
  this.displayedLogs = [...this.filteredLogs];
  if (this.profilerOnly && this.showAnalysis) this.updateProfileStats(); else this.resetProfileStats();
  if (this.slowOnly && this.profilerOnly && this.showAnalysis) this.applySlowFilter();
    this.isLoading = false;
  }

  isApacheHttpStatusInRange(line: string, baseCode: number): boolean {
    const m = line.match(/HTTP\/\d\.\d" (\d{3})/);
    if (!m) return false; const status = +m[1];
    return status >= baseCode && status <= baseCode + 99;
  }

  groupLogs(logs: string[]): string[] {
    const grouped: string[] = [];
    let current: string[] = [];
    let currentTs: string | null = null;
    for (const line of logs) {
      const ts = this.extractTimestamp(line);
      if (ts && ts !== currentTs) {
        if (current.length) grouped.push(current.join('\n'));
        current = []; currentTs = ts;
      }
      current.push(line);
    }
    if (current.length) grouped.push(current.join('\n'));
    return grouped;
  }

  extractTimestamp(line: string): string | null {
    const iso = line.match(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} [+-]\d{2}:\d{2}\]/);
    if (iso) return iso[0];
    const apache = line.match(/\[(\d{2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2} [+-]\d{4}|[A-Za-z]{3} [A-Za-z]{3} \d{2} \d{2}:\d{2}:\d{2}\.\d+ \d{4})\]/);
    if (apache) return apache[0];
    return null;
  }

  filterRequestResponseLogs(logs: string[]): string[] {
    const map = new Map<string, string[]>();
    logs.forEach(group => {
      const req = group.match(/Request ID:([a-zA-Z0-9-]+)/);
      const resp = group.match(/Response ID:([a-zA-Z0-9-]+)/);
      if (req) {
        const id = req[1]; if (!map.has(id)) map.set(id, []);
        if (!this.filterId || group.includes(this.filterId)) map.get(id)!.push(group);
      }
      if (resp) {
        const id = resp[1]; if (!map.has(id)) map.set(id, []);
        if (!this.filterId || group.includes(this.filterId)) map.get(id)!.push(group);
      }
    });
    const result: string[] = [];
    map.forEach(arr => {
      const unique = Array.from(new Set(arr));
      if (!this.filterId || unique.some(l => l.includes(this.filterId))) result.push(unique.join('\n'));
    });
    return result;
  }

  toggleDropdown() { this.dropdownOpen = !this.dropdownOpen; }
  toggleError(error: number) { this.selectedErrorCodes = this.selectedErrorCodes.includes(error) ? this.selectedErrorCodes.filter(c => c !== error) : [...this.selectedErrorCodes, error]; }
  renderSelectedErrors(): string { return this.selectedErrorCodes.length ? this.selectedErrorCodes.join(', ') : 'Error Codes'; }

  highlightFilter(log: string): SafeHtml {
    let hl = log;
    if (this.filterId) {
      const escaped = this.filterId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(`(${escaped})`, 'gi');
      hl = hl.replace(rx, '<span class="highlight">$1</span>');
    }
    if (this.selectedErrorCodes.length) {
      this.selectedErrorCodes.forEach(base => {
        const start = base; const end = base + 99;
        const rx = new RegExp(`HTTP\\/\\d\\.\\d"\\s(${start}|${start+1}|${start+2}|...|${end})`, 'g');
        hl = hl.replace(rx, '<span class="highlight-http">$1</span>');
      });
    }
  // Highlight strict token
  hl = hl.replace(this.profileRegex, m => `<span class=\"highlight-profile-root\">${m}</span>`);
  hl = hl.replace(this.longExecRegex, m => `<span class=\"highlight-profile-root\">${m}</span>`);
  hl = hl.replace(this.executionProfileHeaderRegex, m => `<span class=\"highlight-profile-root\">${m}</span>`);
  return this.sanitizer.bypassSecurityTrustHtml(hl);
  }

  updateProfileStats(): void {
  this.slowGroupIndices.clear();
    const rootLines: { total: number; self: number; }[] = [];
  this.filteredLogs.forEach((group, groupIdx) => {
      const lines = group.split('\n');
      const hasLongExec = lines.some(l => this.longExecRegex.test(l));
      const hasExecutionProfile = lines.some(l => this.executionProfileHeaderRegex.test(l));
      let jobCaptured = false;
      let execRootCaptured = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // /api/data POST root
        let m = this.profileStatsRegex.exec(line);
        if (m) {
          const count = parseInt(m[1],10) || 1;
          const total = parseFloat(m[2]);
          const self = parseFloat(m[3]);
          if (!isNaN(total) && !isNaN(self)) {
            for (let c=0;c<count;c++) rootLines.push({ total, self });
            if (total >= this.slowThreshold) this.slowGroupIndices.add(groupIdx);
          }
          continue;
        }
        // Too long execution: capture first *Job line
        if (hasLongExec && !jobCaptured) {
          const jm = this.longExecJobRegex.exec(line);
          if (jm) {
            const count = parseInt(jm[2],10) || 1;
            const total = parseFloat(jm[3]);
            const selfVal = jm[4] !== undefined ? parseFloat(jm[4]) : 0; // if no self provided treat as 0
            if (!isNaN(total) && !isNaN(selfVal)) {
              for (let c=0;c<count;c++) rootLines.push({ total, self: selfVal });
              if (total >= this.slowThreshold) this.slowGroupIndices.add(groupIdx);
              jobCaptured = true;
            }
            continue;
          }
        }
        // Execution profile: capture first root line after header
        if (hasExecutionProfile && !execRootCaptured) {
          const em = this.executionRootLineRegex.exec(line);
          if (em) {
            const count = parseInt(em[1],10) || 1;
            const total = parseFloat(em[2]);
            const self = em[3] !== undefined ? parseFloat(em[3]) : 0;
            if (!isNaN(total) && !isNaN(self)) {
              for (let c=0;c<count;c++) rootLines.push({ total, self });
              if (total >= this.slowThreshold) this.slowGroupIndices.add(groupIdx);
              execRootCaptured = true;
            }
          }
        }
      }
    });
    if (!rootLines.length) { this.resetProfileStats(); return; }
    const count = rootLines.length;
    const totalSum = rootLines.reduce((s, r) => s + r.total, 0);
    const selfSum = rootLines.reduce((s, r) => s + r.self, 0);
    const maxTotal = rootLines.reduce((m, r) => Math.max(m, r.total), 0);
    const slowCount = rootLines.filter(r => r.total >= this.slowThreshold).length;
    this.aggregatedProfiles = { count, total: totalSum, self: selfSum, maxTotal, slowCount };
  }

  private resetProfileStats() {
    this.aggregatedProfiles = { count: 0, total: 0, self: 0, maxTotal: 0, slowCount: 0 };
    this.slowGroupIndices.clear();
    if (!this.displayedLogs.length) this.displayedLogs = [...this.filteredLogs];
  }

  private applySlowFilter() {
    this.displayedLogs = this.filteredLogs.filter((_, idx) => this.slowGroupIndices.has(idx));
  }


  toggleLogState(index: number, event: Event): void {
    const isOpen = (event.target as HTMLDetailsElement).open;
    this.expandedLogs.set(index, isOpen);
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const dropdown = document.querySelector('.dropdown-content');
    const trigger = document.querySelector('.dropdown-trigger');
    if (this.dropdownOpen && dropdown && trigger && !dropdown.contains(target) && !trigger.contains(target)) {
      this.dropdownOpen = false;
    }
  }
}