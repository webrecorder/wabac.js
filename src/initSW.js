if ('serviceWorker' in navigator) {
  // Register a service worker hosted at the root of the
  // site using a more restrictive scope.

  let path = window.location.origin + window.location.pathname;

  if (!path.endsWith("/")) {
  	path = path.slice(0, path.lastIndexOf("/") + 1);
  }

  navigator.serviceWorker.register(path + 'sw.js', {scope: path}).then(function(registration) {
    console.log('Service worker registration succeeded:', registration);
  }, /*catch*/ function(error) {
    console.log('Service worker registration failed:', error);
  });
} else {
  console.log('Service workers are not supported.');
}

