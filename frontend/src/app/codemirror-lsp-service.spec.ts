import { TestBed } from '@angular/core/testing';

import { CodemirrorLspService } from './codemirror-lsp-service';

describe('CodemirrorLspService', () => {
  let service: CodemirrorLspService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CodemirrorLspService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
