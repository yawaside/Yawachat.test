@@
-import SpeechPanel from "./SpeechPanel";
+import SpeechPanel from "./SpeechPanel";
+import ViewerPanel from "./ViewerPanel";
@@
-        {/* диагностика сети — доступна только в desktop-сборке */}
+        {/* диагностика сети — доступна только в desktop-сборке */}
@@
-        {sp?.diagnoseNet && (
+        {sp?.diagnoseNet && (
@@
-        )}
-
-        {/* панель озвучки — теперь в блоке каналов */}
-        <SpeechPanel
-          speech={speech}
-          onSpeechEnabledChange={onSpeechEnabledChange}
-          toast={toast}
-          compact={channelsCollapsed}
-        />
+        )}
+
+        {/* количество зрителей */}
+        <ViewerPanel compact={channelsCollapsed} />
+
+        {/* панель озвучки — теперь в блоке каналов */}
+        <SpeechPanel
+          speech={speech}
+          onSpeechEnabledChange={onSpeechEnabledChange}
+          toast={toast}
+          compact={channelsCollapsed}
+        />
       </aside>
@@
-      </div>
+      </div>
     );
 }
