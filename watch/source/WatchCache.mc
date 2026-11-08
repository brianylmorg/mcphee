import Toybox.Application;
import Toybox.Background;
import Toybox.Communications;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.WatchUi;

// Foreground and service use identical headers, including preview bypass.
(:background)
function watchOptions(method as Communications.HttpRequestMethod) as Dictionary {
    var headers = {
        "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
        "Authorization" => "Bearer " + WATCH_TOKEN
    };
    if (!WATCH_BYPASS.equals("")) {
        headers["x-vercel-protection-bypass"] = WATCH_BYPASS;
    }
    return {
        :method => method,
        :headers => headers,
        :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
    };
}

// Store just what the glance needs, never the response's millisecond epochs.
// Epoch seconds and agoSec fit in Monkey C's 32-bit Number.
(:background)
function cacheWatchStatus(status as Dictionary) as Void {
    var feeds = [] as Array<Dictionary>;
    var recent = status["recentFeeds"];
    if (recent instanceof Array) {
        for (var i = 0; i < recent.size() && i < 2; i++) {
            var feed = recent[i];
            if (feed instanceof Dictionary && feed["amount"] instanceof Number && feed["agoSec"] instanceof Number) {
                feeds.add({ "amount" => feed["amount"], "agoSec" => feed["agoSec"] });
            }
        }
    } else {
        var last = status["lastFeed"];
        if (last instanceof Dictionary && last["amount"] instanceof Number && status["lastFeedAgoSec"] instanceof Number) {
            feeds.add({ "amount" => last["amount"], "agoSec" => status["lastFeedAgoSec"] });
        }
    }
    try {
        Application.Storage.setValue("glanceStatus", {
            "state" => status["state"],
            "sinceAgoSec" => status["sinceAgoSec"],
            "atChildcare" => status["atChildcare"] == true,
            "recentFeeds" => feeds,
            "storedAt" => Time.now().value()
        });
    } catch (e) {
        // A cache failure must not turn a committed save into a failed save.
        System.println("Glance cache unavailable");
    }
}

(:background)
class McpheeService extends System.ServiceDelegate {
    function initialize() {
        ServiceDelegate.initialize();
    }

    function onTemporalEvent() as Void {
        Communications.makeWebRequest(
            WATCH_SERVER_URL + "/api/watch", null,
            watchOptions(Communications.HTTP_REQUEST_METHOD_GET), method(:onStatus)
        );
    }

    function onStatus(code as Number, data as Dictionary or String or Null) as Void {
        if (code == 200 && data instanceof Dictionary) {
            cacheWatchStatus(data);
        }
        // Keep the previous cache on connectivity or server failures.
        Background.exit(null);
    }
}

(:glance)
class McpheeGlance extends WatchUi.GlanceView {
    function initialize() {
        GlanceView.initialize();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        var cached = Application.Storage.getValue("glanceStatus");
        var line1 = "Open to load";
        var line2 = "";
        if (cached instanceof Dictionary && cached["storedAt"] instanceof Number) {
            var elapsed = Time.now().value() - (cached["storedAt"] as Number);
            if (elapsed < 0) {
                elapsed = 0;
            }
            line1 = "sleeping".equals(cached["state"]) ? "Asleep" : "Awake";
            var since = cached["sinceAgoSec"];
            if (since instanceof Number) {
                line1 += " " + formatShort(since + elapsed);
            }
            if (cached["atChildcare"] == true) {
                line1 = "At childcare";
            }
            var feeds = cached["recentFeeds"];
            if (feeds instanceof Array) {
                for (var i = 0; i < feeds.size() && i < 2; i++) {
                    var feed = feeds[i];
                    if (feed instanceof Dictionary && feed["agoSec"] instanceof Number) {
                        if (!line2.equals("")) {
                            line2 += ", ";
                        }
                        line2 += feed["amount"] + "ml " + formatShort((feed["agoSec"] as Number) + elapsed);
                    }
                }
            }
        }
        var x = dc.getWidth() / 2;
        var y = dc.getHeight() / 2;
        var flags = Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER;
        dc.drawText(x, line2.equals("") ? y : y - 16, Graphics.FONT_SMALL, line1, flags);
        if (!line2.equals("")) {
            dc.drawText(x, y + 16, Graphics.FONT_TINY, line2, flags);
        }
    }
}
