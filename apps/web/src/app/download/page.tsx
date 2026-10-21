import type { Metadata } from 'next';
import { DesktopDownload } from '@/components/desktop-download';

export const metadata: Metadata = {
  title: 'Windows app & Chrome extension | AnchorProposal',
  description: 'Download AnchorProposal for Windows or install the Chrome extension for job capture, applications and parallel resume generation.',
};

export default function DownloadPage() {
  return <DesktopDownload />;
}
