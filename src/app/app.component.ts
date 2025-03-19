import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { LogViewerComponent } from './log-viewer/log-viewer.component';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, LogViewerComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  title = 'log-viewer-app';
}
