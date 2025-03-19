import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms'; // Импортируйте FormsModule
import { AppComponent } from './app.component';
import { LogViewerComponent } from './log-viewer/log-viewer.component';

@NgModule({
  declarations: [
    AppComponent,
    LogViewerComponent
  ],
  imports: [
    BrowserModule,
    FormsModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }