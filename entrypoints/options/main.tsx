import { render } from 'preact';
import { Options } from './Options';
import './options.css';

const app = document.getElementById('app');
if (app) {
  render(<Options />, app);
}
