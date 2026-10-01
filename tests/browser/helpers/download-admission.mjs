import { basename } from 'node:path';

// Each positive download requires its exact project, file and scenario. The
// Audio/Slides suites also require their explicitly supplied detached backend
// before the context can start. This does not authorize obtaining that fixture.
export function admittedBrowserDownload({ project, file, title, synthetic }) {
  const name = basename(file);
  if (project === 'story-revision-download' && name === 'forma-story-revision-download.spec.mjs')
    return title === 'Story revision one: approved synthetic source downloads the exact Markdown file';
  if (project === 'audio-reviewed-download' && name === 'forma-audio-reviewed-download.spec.mjs')
    return title === 'Audio declared reviewed original WAV downloads once and reopens as exact retained bytes';
  if (project === 'slides-reviewed-download' && name === 'forma-slides-reviewed-download.spec.mjs')
    return title === 'Slides declared reviewed revision one downloads one audience PowerPoint file';
  return synthetic && name === 'forma-memory-purposes.spec.mjs'
    && ['Memory purposes: explicit inactive controls in en', 'Memory purposes: explicit inactive controls in ar'].includes(title);
}
