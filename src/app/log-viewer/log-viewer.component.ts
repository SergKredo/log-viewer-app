import { ChangeDetectorRef, Component, HostListener, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ScrollingModule } from '@angular/cdk/scrolling';

@Component({
  selector: 'app-log-viewer',
  templateUrl: './log-viewer.component.html',
  styleUrls: ['./log-viewer.component.css'],
  imports: [CommonModule, FormsModule, MatSelectModule, MatFormFieldModule, ScrollingModule]
})
export class LogViewerComponent {
  fileName: string = '';
  logs: string[] = [];
  filteredLogs: string[] = [];
  expandedLogs: Map<number, boolean> = new Map(); // Stores expanded/collapsed state of logs
  filterId: string = '';
  totalLogs: number = 0;
  highlightSignalR: boolean = false;
  highlightHub: boolean = false;
  filterSignalR: boolean = false;
  filterRequestResponse: boolean = false;
  isLoading: boolean = false;

  errorCodes: number[] = [100, 200, 300, 400, 500]; 
  selectedErrorCodes: number[] = []; 
  dropdownOpen = false;

  constructor(private sanitizer: DomSanitizer, private cdr: ChangeDetectorRef, private zone: NgZone) {}

  loadFile(event: any): void {
    const file = event.target.files[0];
    if (!file) return;

    this.fileName = file.name;
    this.isLoading = true; // Start loading
    const reader = new FileReader();
    reader.onload = (e: any) => {
      this.zone.run(() => {
        this.logs = e.target.result.split('\n');
        this.filteredLogs = this.groupLogs(this.logs);
        this.totalLogs = this.filteredLogs.length;
        this.isLoading = false; // End loading
        this.cdr.detectChanges(); // Notify Angular about changes
      });
    };
    reader.readAsText(file);
  }

  saveFilteredLogs(): void {
    const blob = new Blob([this.filteredLogs.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'filtered-logs.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  filterLogs(): void {
    this.isLoading = true;
  
    let filtered = this.groupLogs(this.logs);
  
    if (this.filterId) {
      const lowerCaseFilterId = this.filterId.toLowerCase();
      filtered = filtered.filter(group => group.split('\n').some(line => line.toLowerCase().includes(lowerCaseFilterId)));
    }

    if (this.filterSignalR || this.highlightSignalR || this.highlightHub) {
      filtered = filtered.filter(group =>
        group.split('\n').some(line => {
          const includesSignalR = line.includes('[SignalR]');
          const includesHub = line.includes('WebScapeHub');
  
          return (
            (this.filterSignalR && (includesSignalR || includesHub)) || // [SignalR]
            (this.highlightSignalR && includesSignalR) || // Client-[SignalR]
            (this.highlightHub && includesHub) // Hub-[SignalR]
          );
        })
      );
    }

    if (this.selectedErrorCodes.length > 0) {
      filtered = filtered.filter(group =>
        group.split('\n').some(line => this.selectedErrorCodes.some(code => this.isApacheHttpStatusInRange(line, code)))
      );
    }
  
    if (this.filterRequestResponse) {
      filtered = this.filterRequestResponseLogs(filtered);
    }
  
    this.filteredLogs = filtered;
    this.isLoading = false;
  }

  isApacheHttpStatusInRange(line: string, baseCode: number): boolean {
    const apacheStatusMatch = line.match(/HTTP\/\d\.\d" (\d{3})/);
    if (apacheStatusMatch) {
      const status = parseInt(apacheStatusMatch[1], 10);
      const rangeStart = baseCode;
      const rangeEnd = baseCode + 99;
      return status >= rangeStart && status <= rangeEnd;
    }
    return false;
  }

  groupLogs(logs: string[]): string[] {
    const groupedLogs: string[] = [];
    let currentLog: string[] = [];
    let currentTimestamp: string | null = null;

    for (const line of logs) {
      const timestamp = this.extractTimestamp(line);
      if (timestamp && timestamp !== currentTimestamp) {
        if (currentLog.length > 0) {
          groupedLogs.push(currentLog.join('\n'));
          currentLog = [];
        }
        currentTimestamp = timestamp;
      }
      currentLog.push(line);
    }

    if (currentLog.length > 0) {
      groupedLogs.push(currentLog.join('\n'));
    }

    return groupedLogs;
  }

  extractTimestamp(line: string): string | null {
    const isoMatch = line.match(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} [+-]\d{2}:\d{2}\]/);
    if (isoMatch) {
      return isoMatch[0];
    }

    const apacheMatch = line.match(/\[\d{2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2} [+-]\d{4}\]/);
    if (apacheMatch) {
      return apacheMatch[0];
    }

    return null;
  }

  filterRequestResponseLogs(logs: string[]): string[] {
    const requestResponseLogs: string[] = [];
    const requestResponseMap: Map<string, string[]> = new Map();

    logs.forEach(log => {
      const requestIdMatch = log.match(/Request ID:([a-zA-Z0-9-]+)/);
      const responseIdMatch = log.match(/Response ID:([a-zA-Z0-9-]+)/);

      if (requestIdMatch) {
        const requestId = requestIdMatch[1];
        if (!requestResponseMap.has(requestId)) {
          requestResponseMap.set(requestId, []);
        }
        if (!this.filterId || log.includes(this.filterId)) {
          requestResponseMap.get(requestId)!.push(log);
        }
      }

      if (responseIdMatch) {
        const responseId = responseIdMatch[1];
        if (!requestResponseMap.has(responseId)) {
          requestResponseMap.set(responseId, []);
        }
        if (!this.filterId || log.includes(this.filterId)) {
          requestResponseMap.get(responseId)!.push(log);
        }
      }
    });

    requestResponseMap.forEach((logs, id) => {
      const uniqueLogs = Array.from(new Set(logs));
      if (!this.filterId || uniqueLogs.some(log => log.includes(this.filterId))) {
        requestResponseLogs.push(uniqueLogs.join('\n'));
      }
    });

    return requestResponseLogs;
  }

  toggleDropdown() {
    this.dropdownOpen = !this.dropdownOpen;
  }

  toggleError(error: number) {
    if (this.selectedErrorCodes.includes(error)) {
      this.selectedErrorCodes = this.selectedErrorCodes.filter(code => code !== error);
    } else {
      this.selectedErrorCodes.push(error);
    }
  }

  renderSelectedErrors(): string {
    return this.selectedErrorCodes.length > 0 ? this.selectedErrorCodes.join(', ') : 'Error Codes';
  }

  highlightFilter(log: string): SafeHtml {
    let highlightedLog = log;
  
    if (this.filterId) {
      const escapedFilterId = this.filterId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escapedFilterId})`, 'gi');
      highlightedLog = highlightedLog.replace(regex, '<span class="highlight">$1</span>');
    }
  
    if (this.selectedErrorCodes.length > 0) {
      this.selectedErrorCodes.forEach(baseCode => {
        const rangeStart = baseCode;
        const rangeEnd = baseCode + 99;
        const statusRegex = new RegExp(`HTTP\\/\\d\\.\\d"\\s(${rangeStart}|${rangeStart + 1}|${rangeStart + 2}|...|${rangeEnd})`, 'g');
        highlightedLog = highlightedLog.replace(statusRegex, '<span class="highlight-http">$1</span>');
      });
    }
  
    return this.sanitizer.bypassSecurityTrustHtml(highlightedLog);
  }

  toggleLogState(index: number, event: Event): void {
    const isOpen = (event.target as HTMLDetailsElement).open;
    this.expandedLogs.set(index, isOpen);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const dropdown = document.querySelector('.dropdown-content');
    const trigger = document.querySelector('.dropdown-trigger');

    if (this.dropdownOpen && dropdown && trigger && !dropdown.contains(target) && !trigger.contains(target)) {
      this.dropdownOpen = false;
    }
  }
}