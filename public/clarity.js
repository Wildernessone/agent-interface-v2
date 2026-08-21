/* Microsoft Clarity — session recordings and heatmaps for agentinterface.app.
   No gating is needed here beyond the production host. The v2 APP was retired in the 2026-07-24
   pivot and its user data (BYOK provider keys, conversations, projects, the two auth users) was
   scrubbed, so this domain is now a pure reference site: the hub, the tracker, and the guides.
   There is no account, no session and no private record on any page for Clarity to record.
   The host check keeps preview deployments out of the project so the rates stay honest.
   Worth remembering: Microsoft runs Clarity as a data CONTROLLER, not a processor, and keeps
   recordings for 30 days. Rolling window, not an archive. */
(function () {
  'use strict';
  try {
    var h = location.hostname;
    if (h !== 'agentinterface.app' && h !== 'www.agentinterface.app') return;
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', 'y5n6oyesxg');
  } catch (e) {}
})();
