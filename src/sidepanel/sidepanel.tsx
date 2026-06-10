// Side-panel shell: mounts the same host-agnostic ReviewView with the same
// chrome transport as the page shell. No view-logic fork (DESIGN §3.4).

import { render } from 'preact';

import { ReviewView } from '@/view/ReviewView';
import { chromeTransport } from '@/view/transport';
import '@/view/review.css';

const root = document.getElementById('app');
if (root) render(<ReviewView transport={chromeTransport} />, root);
