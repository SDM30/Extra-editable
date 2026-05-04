import { TestBed } from '@angular/core/testing';

import { LspService } from './lsp-service';

describe('LspService', () => {
  let service: LspService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(LspService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
