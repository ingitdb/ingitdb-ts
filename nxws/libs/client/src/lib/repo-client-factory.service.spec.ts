import { TestBed } from '@angular/core/testing';

import { RepoClientFactoryService } from './repo-client-factory.service';

describe('RepoClientFactoryService', () => {
  let service: RepoClientFactoryService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(RepoClientFactoryService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
