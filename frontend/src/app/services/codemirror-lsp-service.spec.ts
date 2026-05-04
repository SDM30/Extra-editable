import { TestBed } from '@angular/core/testing';

import { CodeMirrorLspService } from './codemirror-lsp-service';

describe('CodemirrorLspService', () => {
  let service: CodeMirrorLspService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CodeMirrorLspService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
