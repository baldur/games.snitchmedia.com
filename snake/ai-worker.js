// Module worker that does the demo snake's thinking. The 2010 Snake checked its
// collisions in a Web Worker; this one plans the attract-mode snake's route in one.
import { chooseDir } from './ai.js';

onmessage = ({ data }) => postMessage({ id: data.id, dir: chooseDir(data) });
