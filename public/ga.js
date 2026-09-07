/* ga.js — Google Analytics 4 (gtag) for agentinterface.app.
   Plain ES5 classic script. Fail-closed: any error is swallowed; never blocks Clarity.

   Measurement ID: G-WEF0SF3GYY (Wilderness Portfolio / Agent Interface)
   Host gate mirrors public/clarity.js — preview deploys must not pollute sale-history data. */
(function () {
  'use strict';
  var MEASUREMENT_ID = 'G-WEF0SF3GYY';
  try {
    var h = location.hostname;
    if (h !== 'agentinterface.app' && h !== 'www.agentinterface.app') return;

    window.dataLayer = window.dataLayer || [];
    function gtag(){ window.dataLayer.push(arguments); }
    window.gtag = window.gtag || gtag;
    gtag('js', new Date());
    gtag('config', MEASUREMENT_ID, { anonymize_ip: true, send_page_view: true });

    var s = document.createElement('script');
    s.async = 1;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
    var first = document.getElementsByTagName('script')[0];
    first.parentNode.insertBefore(s, first);
  } catch (e) {}
})();
