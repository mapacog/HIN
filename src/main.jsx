import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/oswald/500.css';
import '@fontsource/oswald/600.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import '@arcgis/core/assets/esri/themes/light/main.css';
import './styles.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
