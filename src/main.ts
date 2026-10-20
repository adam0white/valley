import '@adam0white/lab-kit/stage.css';
import './ui/style.css';
import { _debug, start } from './ui/app.ts';

if (import.meta.env.DEV) (window as unknown as { __valley: typeof _debug }).__valley = _debug;
start();
