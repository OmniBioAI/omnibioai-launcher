import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { connectAppearanceMessages } from './embedAppearance';

connectAppearanceMessages();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
