import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CodeSection } from './code-section';

describe('CodeSection', () => {
  let component: CodeSection;
  let fixture: ComponentFixture<CodeSection>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodeSection]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CodeSection);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
