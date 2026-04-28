import { Component } from '@angular/core';
import { AuthCardComponent } from '../auth-card/auth-card.component';

@Component({
  selector: 'app-auth-wrap',
  templateUrl: './auth-wrap.component.html',
  styleUrls: ['./auth-wrap.component.css'],
  standalone: true,
  imports: [AuthCardComponent],
})
export class AuthWrapComponent {}