import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

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
      </div>
      <div class="log-info">
        <label>Total logs in file: {{ totalLogs }}</label>
        <label>Filtered logs: {{ filteredLogs.length }}</label>
      </div>
      <div class="log-container">
        <div *ngIf="isLoading" class="loader">Loading...</div>
        <details *ngFor="let log of filteredLogs" [ngClass]="{'highlight-signalr': highlightSignalR && log.includes('[SignalR]'), 'highlight-hub': highlightHub && log.includes('WebScapeHub')}">
          <summary>{{ log.split('\n')[0] }}</summary>
          <pre>{{ log }}</pre>
        </details>
      </div>
    </div>
  `,
  styles: [
    `.container { width: 100%; height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 20px; box-sizing: border-box; }`,
    `.controls { display: flex; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; justify-content: center; align-items: center; }`,
    `input, button { padding: 5px; }`,
    `.filter-input { width: 400px; }`, // Increase input field width
    `.log-info { display: flex; gap: 20px; margin-bottom: 10px; justify-content: center; }`,
    `.log-container { width: 100%; flex-grow: 1; text-align: left; background: #f4f4f4; padding: 10px; overflow-y: auto; border: 1px solid #ccc;}`,
    `.label { margin-right: 10px; }`,
    `.signalr-label { display: flex; align-items: center; background-color: red; padding: 5px; border-radius: 5px; }`,
    `.hub-label { display: flex; align-items: center; background-color: yellow; padding: 5px; border-radius: 5px; }`,
    `.filter-signalr-label { display: flex; align-items: center; }`,
    `.highlight-signalr { background-color: #ffcccc; }`, // Red background color for highlighting
    `.highlight-hub { background-color: #ffffcc; }`, // Yellow background color for highlighting
    `.loader { text-align: center; font-size: 20px; padding: 20px; }` // Loader style
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
  isLoading: boolean = false; // Loading state

  loadFile(event: any): void {
    const file = event.target.files[0];
    if (!file) return;
    this.isLoading = true; // Start loading
    const reader = new FileReader();
    reader.onload = (e: any) => {
      this.logs = e.target.result.split('\n');
      this.filteredLogs = this.groupLogs(this.logs);
      this.totalLogs = this.filteredLogs.length;
      this.isLoading = false; // End loading
    };
    reader.readAsText(file);
  }

  filterLogs(): void {
    this.isLoading = true; // Start loading
    let filtered = this.logs;

    if (this.filterId) {
      filtered = filtered.filter(line => line.includes(this.filterId));
    }

    if (this.filterSignalR) {
      filtered = filtered.filter(line => line.includes('[SignalR]') || line.includes('WebScapeHub'));
    }

    this.filteredLogs = this.groupLogs(filtered);
    this.isLoading = false; // End loading
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
    const match = line.match(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} [+-]\d{2}:\d{2}\]/);
    return match ? match[0] : null;
  }
  
  isTimestamp(line: string): boolean {
    return this.extractTimestamp(line) !== null;
  }
}