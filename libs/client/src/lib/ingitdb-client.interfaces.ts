import {ViewCol} from '@ingitdb/schema';
import { Row } from './repo-client.interface';

export interface List {
  columns: ViewCol[];
  rows: Row[];
}
