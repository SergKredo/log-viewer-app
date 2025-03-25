import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
    `.highlight { background-color: #28a745; color: white; font-weight: bold; padding: 2px 4px; border-radius: 3px; }`
  ],
  imports: [CommonModule, FormsModule]
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
    // ISO 8601 format
    const isoMatch = line.match(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} [+-]\d{2}:\d{2}\]/);
    if (isoMatch) {
      return isoMatch[0];
    }

    // Apache format
    const apacheMatch = line.match(/\[\d{2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2} [+-]\d{4}\]/);
    if (apacheMatch) {
      return apacheMatch[0];
    }

    return null; // If no timestamp is found
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
        // Filter by identifier when adding logs
        if (!this.filterId || log.includes(this.filterId)) {
          requestResponseMap.get(requestId)!.push(log);
        }
      }

      if (responseIdMatch) {
        const responseId = responseIdMatch[1];
        if (!requestResponseMap.has(responseId)) {
          requestResponseMap.set(responseId, []);
        }
        // Filter by identifier when adding logs
        if (!this.filterId || log.includes(this.filterId)) {
          requestResponseMap.get(responseId)!.push(log);
        }
      }
    });

    // Create unique logs for each ID
    requestResponseMap.forEach((logs, id) => {
      const uniqueLogs = Array.from(new Set(logs));
      // Ensure the result contains only logs with the specified identifier
      if (!this.filterId || uniqueLogs.some(log => log.includes(this.filterId))) {
        requestResponseLogs.push(uniqueLogs.join('\n'));
      }
    });

    return requestResponseLogs;
  }

  highlightFilter(log: string): SafeHtml {
    if (!this.filterId) {
      return log; // If the filter is not set, return the log unchanged
    }
    const escapedFilterId = this.filterId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape special characters
    const regex = new RegExp(`(${escapedFilterId})`, 'gi'); // Regular expression to find the identifier
    const highlightedLog = log.replace(regex, '<span class="highlight">$1</span>'); // Insert <span> tag with the highlight class
    return this.sanitizer.bypassSecurityTrustHtml(highlightedLog); // Mark the HTML as safe
  }
}