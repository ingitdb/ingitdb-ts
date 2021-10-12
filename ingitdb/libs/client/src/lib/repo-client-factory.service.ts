import {Injectable} from '@angular/core';
import {GithubRepoService} from './repo-client.github.service';
import {RepoClient} from './repo-client.interface';

@Injectable({
  providedIn: 'root'
})
export class RepoClientFactoryService {

  constructor(
    private readonly github: GithubRepoService,
  ) {
  }

  getRepoClient(host: string): RepoClient {
    switch (host) {
      case 'github.com':
        return this.github;
      default:
        throw new Error('unknown host: ' + host);
    }
  }
}
