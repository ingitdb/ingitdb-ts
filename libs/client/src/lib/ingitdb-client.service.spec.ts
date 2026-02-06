import { TestBed } from '@angular/core/testing';

import { IngitDbClientService } from './ingitdb-client.service';

describe('IngitDbClientService', () => {
  let service: IngitDbClientService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(IngitDbClientService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
