import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-700.css';
import './styles/main.css';
import { Game } from './game/Game.js';

function start() {
  const game = new Game(document.getElementById('app'));
  // handy for poking at the prototype from the browser console
  window.__game = game;
}

// Wait for the UI font so canvas text doesn't swap fonts mid-animation
// (falls back after a short timeout if the font is slow or unavailable).
const fontReady = document.fonts?.load
  ? Promise.race([
      Promise.all([document.fonts.load('700 16px Fredoka'), document.fonts.load('600 16px Fredoka')]),
      new Promise((r) => setTimeout(r, 800)),
    ])
  : Promise.resolve();

fontReady.catch(() => {}).finally(start);
