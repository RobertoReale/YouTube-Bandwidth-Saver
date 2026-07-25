import { render } from 'preact';
import { Popup } from './Popup';
import './popup.css';

const app = document.getElementById('app');
if (app) {
  render(<Popup />, app);
}
