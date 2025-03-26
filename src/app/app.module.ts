import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms'; // Импортируйте FormsModule
import { AppComponent } from './app.component';
import { LogViewerComponent } from './log-viewer/log-viewer.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { ScrollingModule } from '@angular/cdk/scrolling';

@NgModule({
  declarations: [
    AppComponent,
    LogViewerComponent
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule, // Required for Angular Material
    FormsModule,
    MatSelectModule,
    MatCheckboxModule,
    MatFormFieldModule,
    ScrollingModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }