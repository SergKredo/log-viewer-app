import { Component } from '@angular/core';
import { LogViewerComponent } from './log-viewer/log-viewer.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  imports: [LogViewerComponent]
})
export class AppComponent {
  title = 'log-viewer-app';
}
