const CameraPreview = (() => {
  const workerSource = `
    let track;
    let reader;

    async function sendFrame() {
      try {
        const { done, value } = await reader.read();
        if (done) {
          self.postMessage(null);
          return;
        }
        try {
          self.postMessage(value, [value]);
        } catch {
          value.close();
          self.postMessage(null);
        }
      } catch {
        self.postMessage(null);
      }
    }

    self.onmessage = ({ data }) => {
      if (data === 'stop') {
        track?.stop();
        self.close();
      } else if (data === 'next') {
        sendFrame();
      } else {
        track = data;
        try {
          reader = new MediaStreamTrackProcessor({ track, maxBufferSize: 1 }).readable.getReader();
          sendFrame();
        } catch {
          track.stop();
          self.postMessage(null);
        }
      }
    };
  `;

  function draw(canvas, frame) {
    const width = frame.displayWidth || frame.width;
    const height = frame.displayHeight || frame.height;
    if (!width || !height) throw new Error('empty_frame');

    const scale = Math.min(1, 768 / Math.max(width, height));
    const displayWidth = Math.max(1, Math.round(width * scale));
    const displayHeight = Math.max(1, Math.round(height * scale));
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
    }
    canvas.getContext('2d', { alpha: false }).drawImage(frame, 0, 0, displayWidth, displayHeight);
  }

  function startFrameLoop(open, canvas, signal, onError) {
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      let ready = false;
      let stopped = false;
      let close = () => {};
      const finish = error => {
        if (stopped) return;
        stopped = true;
        clearTimeout(deadline);
        signal.removeEventListener('abort', abort);
        close();
        if (!ready) reject(error);
        else if (!signal.aborted) onError(error);
      };
      const abort = () => finish(signal.reason);
      const deadline = setTimeout(() => finish(new Error('preview_timeout')), 2200);
      signal.addEventListener('abort', abort, { once: true });

      const receive = frame => {
        try {
          if (stopped) return;
          draw(canvas, frame);
          if (!ready) {
            ready = true;
            clearTimeout(deadline);
            resolve(canvas);
          }
        } catch (error) {
          finish(error);
        } finally {
          frame.close();
        }
      };

      try {
        close = open(receive, finish);
      } catch (error) {
        finish(error);
      }
    });
  }

  function openImageCapture(track, receive, fail) {
    const capture = new ImageCapture(track);
    let timer;
    let stopped = false;

    async function grab() {
      try {
        receive(await capture.grabFrame());
        if (!stopped) timer = setTimeout(grab, 42);
      } catch (error) {
        if (!stopped) fail(error);
      }
    }
    grab();

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }

  function openWorker(track, receive, fail) {
    const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    let worker;
    try {
      worker = new Worker(url);
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }

    worker.onmessage = ({ data: frame }) => {
      if (!frame) {
        fail(new Error('worker_preview_unavailable'));
        return;
      }
      receive(frame);
      if (worker.onmessage) worker.postMessage('next');
    };
    worker.onerror = event => {
      event.preventDefault();
      fail(new Error('worker_preview_unavailable'));
    };

    let clone;
    try {
      clone = track.clone();
      worker.postMessage(clone, [clone]);
    } catch (error) {
      clone?.stop();
      URL.revokeObjectURL(url);
      worker.terminate();
      throw error;
    }

    return () => {
      worker.onmessage = null;
      worker.onerror = null;
      URL.revokeObjectURL(url);
      worker.postMessage('stop');
      setTimeout(() => worker.terminate(), 250);
    };
  }

  function isAppleMobile() {
    const agent = navigator.userAgent;
    return /iPhone|iPad|iPod/i.test(agent) || (/Macintosh/i.test(agent) && navigator.maxTouchPoints > 1);
  }

  async function start(stream, canvas, video, signal, onError) {
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('no_video_track');

    const backends = [];
    if (typeof ImageCapture !== 'undefined' && typeof ImageCapture.prototype.grabFrame === 'function') {
      backends.push(openImageCapture);
    }
    if (typeof Worker !== 'undefined' && typeof VideoFrame !== 'undefined') backends.push(openWorker);

    for (const backend of backends) {
      try {
        return await startFrameLoop((receive, fail) => backend(track, receive, fail), canvas, signal, onError);
      } catch {
        signal.throwIfAborted();
      }
    }

    // An iOS app's webview can force a video element into native full-screen playback.
    // Drawing frames above does not depend on that app's inline playback settings.
    if (isAppleMobile()) throw new Error('inline_camera_unavailable');

    signal.throwIfAborted();
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.classList.remove('hidden');
    await video.play();
    signal.throwIfAborted();
    return video;
  }

  return { start };
})();

export default CameraPreview;
