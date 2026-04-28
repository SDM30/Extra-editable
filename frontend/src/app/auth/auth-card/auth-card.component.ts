import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LoginFormComponent } from '../login-form/login-form.component';
import { RegisterFormComponent } from '../register-form/register-form.component';


@Component({
  selector: 'app-auth-card',
  templateUrl: './auth-card.component.html',
  styleUrls: ['./auth-card.component.css'],
  standalone: true,
  imports: [CommonModule, LoginFormComponent, RegisterFormComponent], 
})
export class AuthCardComponent {
  mostrarLogin = true;

  onToggleForm(): void {
    this.mostrarLogin = !this.mostrarLogin;
  }
}
