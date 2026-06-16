<script lang="ts">
  import '../reset.css';
  import '../app.css';
  import { browser } from '$app/environment';
  import { logger, set_logger } from '$lib/telemetry';
  import { create_otel_console_logger } from '$lib/telemetry/otel_console_logger';

  if (browser) {
    set_logger(create_otel_console_logger());
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) logger.event('bfcache.restore', { persisted: true });
    });
  }

  let { children } = $props();
</script>

{@render children()}
