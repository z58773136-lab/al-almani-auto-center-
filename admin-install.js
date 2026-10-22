(() => {
  const button = document.getElementById("installDesktopApp");
  let installPrompt = null;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
    });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
  });

  if (!button) return;
  button.addEventListener("click", async () => {
    if (window.matchMedia("(display-mode: standalone)").matches) {
      alert("برنامج إدارة المركز مثبت بالفعل على هذا الكمبيوتر.");
      return;
    }
    if (installPrompt) {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      return;
    }
    alert("لتثبيت البرنامج: افتح الرابط في Google Chrome أو Microsoft Edge، ثم من القائمة ⋮ اختر Apps أو التطبيقات ثم Install this site as an app أو تثبيت هذا الموقع كتطبيق.");
  });

  window.addEventListener("appinstalled", () => {
    button.innerHTML = '<i class="fa-solid fa-check"></i> البرنامج مثبت على الكمبيوتر';
  });
})();

