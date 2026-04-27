import { TestBed } from '@angular/core/testing';

import { execution } from './execution';

describe('execution', () => {
  let service: execution;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(execution);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
