import { TestBed } from '@angular/core/testing';

import { CodigoFuenteServ } from './codigo-fuente-serv';

describe('CodigoFuente', () => {
  let service: CodigoFuenteServ;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CodigoFuenteServ);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
