// Page shell: mounts the host-agnostic ReviewView with the real chrome
// transport. A future side-panel shell mounts the same component with the same
// transport — no view logic forks (DESIGN §3.4).

import { render } from 'preact';

import { ReviewView } from '@/view/ReviewView';
import { chromeTransport } from '@/view/transport';
import '@/view/review.css';

const root = document.getElementById('app');
if (root) render(<ReviewView transport={chromeTransport} />, root);
