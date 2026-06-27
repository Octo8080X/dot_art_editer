import './style.css';
import { buildEditor } from './ui';

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  buildEditor(app);
}
