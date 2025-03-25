import { Component, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-log-viewer',
  template: `
    <div class="container">
      <h2>Log Upload and Filtering</h2>
      <div class="controls">
        <input type="file" (change)="loadFile($event)" accept=".log,.txt" />
        <input type="text" [(ngModel)]="filterId" placeholder="Enter identifier" class="filter-input" />
        <button (click)="filterLogs()">Filter</button>
        <label class="signalr-label">
          <input type="checkbox" [(ngModel)]="highlightSignalR" /> Client-[SignalR]
        </label>
        <label class="hub-label">
          <input type="checkbox" [(ngModel)]="highlightHub" /> Hub-[SignalR]
        </label>
        <label class="filter-signalr-label">
          <input type="checkbox" [(ngModel)]="filterSignalR" (change)="filterLogs()" /> [SignalR]
        </label>
        <label class="request-response-label">
          <input type="checkbox" [(ngModel)]="filterRequestResponse" (change)="filterLogs()" /> Request-Response
        </label>
        <!-- Updated Error Code Control -->
        <div class="error-code-control">
          <label class="error-code-label">[HTTP code Apache]</label>
          <div class="dropdown">
            <button (click)="toggleDropdown()" class="dropdown-trigger fixed-width">{{ renderSelectedErrors() }}</button>
            <div *ngIf="dropdownOpen" class="dropdown-content">
              <label *ngFor="let error of errorCodes" class="dropdown-item">
                <input 
                  type="checkbox" 
                  [value]="error" 
                  (change)="toggleError(error)" 
                  [checked]="selectedErrorCodes.includes(error)"
                /> {{ error }}
              </label>
            </div>
          </div>
        </div>
      </div>
      <div class="log-info">
        <label>Total logs in file: {{ totalLogs }}</label>
        <label>Filtered logs: {{ filteredLogs.length }}</label>
      </div>
      <div class="log-container" (scroll)="onScroll($event)">
        <div *ngIf="isLoading" class="loader">Loading...</div>
        <details *ngFor="let log of visibleLogs" [ngClass]="{'highlight-signalr': highlightSignalR && log.includes('[SignalR]'), 'highlight-hub': highlightHub && log.includes('WebScapeHub')}">
          <summary>{{ log.split('\n')[0] }}</summary>
          <pre [innerHTML]="highlightFilter(log)"></pre>
        </details>
      </div>
    </div>
  `,
  styles: [
    `.container { width: 100%; height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 20px; box-sizing: border-box; }`,
    `.controls { display: flex; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; justify-content: center; align-items: center; }`,
    `input, button { padding: 5px; }`,
    `.filter-input { width: 400px; }`,
    `.log-info { display: flex; gap: 20px; margin-bottom: 10px; justify-content: center; }`,
    `.log-container { width: 100%; flex-grow: 1; text-align: left; background: #f4f4f4; padding: 10px; overflow-y: auto; border: 1px solid #ccc;}`,
    `.label { margin-right: 10px; }`,
    `.signalr-label { display: flex; align-items: center; background-color: red; padding: 5px; border-radius: 5px; }`,
    `.hub-label { display: flex; align-items: center; background-color: yellow; padding: 5px; border-radius: 5px; }`,
    `.filter-signalr-label { display: flex; align-items: center; }`,
    `.request-response-label { display: flex; align-items: center; }`,
    `.highlight-signalr { background-color: #ffcccc; }`,
    `.highlight-hub { background-color: #ffffcc; }`,
    `.loader { text-align: center; font-size: 20px; padding: 20px; }`,
    `.highlight { background-color: #28a745; color: white; font-weight: bold; padding: 2px 4px; border-radius: 3px; }`,
    `.highlight-http { background-color: orange; color: black; font-weight: bold; padding: 2px 4px; border-radius: 3px; }`,
    `::ng-deep .error-code-control { position: relative; display: inline-flex; align-items: center; gap: 10px; }`,
    `::ng-deep .error-code-label { font-weight: bold; }`,
    `::ng-deep .dropdown-trigger.fixed-width { width: 200px; padding: 5px 10px; background-color: white; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; text-align: left; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }`,
    `::ng-deep .dropdown { position: relative;}`,
    `::ng-deep .dropdown-content { 
      position: absolute; 
      top: 100%; 
      left: 0;
      background: white; 
      border: 1px solid #ccc; 
      border-radius: 4px; 
      padding: 5px; 
      z-index: 1000; 
      min-width: 94%;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2); 
    }`,
    `::ng-deep .dropdown-item { display: flex; align-items: center; padding: 2px 0; }`,
    `::ng-deep .dropdown-item input { margin-right: 5px; }`
  ],
  imports: [CommonModule, FormsModule, MatSelectModule, MatFormFieldModule]
})
export class LogViewerComponent {
  logs: string[] = [];
  filteredLogs: string[] = [];
  filterId: string = '';
  totalLogs: number = 0;
  highlightSignalR: boolean = false;
  highlightHub: boolean = false;
  filterSignalR: boolean = false;
  filterRequestResponse: boolean = false;
  isLoading: boolean = false;

  pageSize: number = 100; // Number of logs per page
  currentPage: number = 0; // Current page index
  visibleLogs: string[] = []; // Logs currently visible on the page

  errorCodes: number[] = [100, 200, 300, 400, 500]; 
  selectedErrorCodes: number[] = []; 
  dropdownOpen = false;

  constructor(private sanitizer: DomSanitizer) {}

  loadFile(event: any): void {
    const file = event.target.files[0];
    if (!file) return;
    this.isLoading = true; // Start loading
    const reader = new FileReader();
    reader.onload = (e: any) => {
      this.logs = e.target.result.split('\n');
      this.filteredLogs = this.groupLogs(this.logs);
      this.totalLogs = this.filteredLogs.length;
      this.currentPage = 0;
      this.updateVisibleLogs();
      this.isLoading = false; // End loading
    };
    reader.readAsText(file);
  }

  updateVisibleLogs(): void {
    const start = this.currentPage * this.pageSize;
    const end = start + this.pageSize;
    this.visibleLogs = this.filteredLogs.slice(start, end);
  }

  onScroll(event: any): void {
    const { scrollTop, scrollHeight, clientHeight } = event.target;
    if (scrollTop + clientHeight >= scrollHeight) {
      this.loadNextPage();
    }
  }

  loadNextPage(): void {
    if ((this.currentPage + 1) * this.pageSize < this.filteredLogs.length) {
      this.currentPage++;
      this.updateVisibleLogs();
    }
  }

  filterLogs(): void {
    this.isLoading = true;
  
    // Start by grouping logs
    let filtered = this.groupLogs(this.logs);
  
    // Filter by identifier
    if (this.filterId) {
      filtered = filtered.filter(group => group.split('\n').some(line => line.includes(this.filterId)));
    }
  
    // Filter by SignalR
    if (this.filterSignalR) {
      filtered = filtered.filter(group => group.split('\n').some(line => line.includes('[SignalR]') || line.includes('WebScapeHub')));
    }
  
    // Filter by selected error codes (Apache HTTP status codes)
    if (this.selectedErrorCodes.length > 0) {
      filtered = filtered.filter(group =>
        group.split('\n').some(line => this.selectedErrorCodes.some(code => this.isApacheHttpStatusInRange(line, code)))
      );
    }
  
    // Apply other filters if needed
    if (this.filterRequestResponse) {
      filtered = this.filterRequestResponseLogs(filtered);
    }
  
    // Update filtered logs
    this.filteredLogs = filtered;
    this.currentPage = 0;
    this.updateVisibleLogs();
    this.isLoading = false;
  }

  isApacheHttpStatusInRange(line: string, baseCode: number): boolean {
    // Match Apache HTTP status codes in the log line
    const apacheStatusMatch = line.match(/HTTP\/\d\.\d" (\d{3})/);
    if (apacheStatusMatch) {
      const status = parseInt(apacheStatusMatch[1], 10);
      const rangeStart = baseCode;
      const rangeEnd = baseCode + 99; // Define the range (e.g., 200-299 for 200)
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
  
    // Highlight filterId if provided
    if (this.filterId) {
      const escapedFilterId = this.filterId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escapedFilterId})`, 'gi');
      highlightedLog = highlightedLog.replace(regex, '<span class="highlight">$1</span>');
    }
  
    // Highlight selected HTTP status codes
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