(() => {
  let installPrompt = null;
  const installButton = document.getElementById("installApp");

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {}));
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
  });

  if (!installButton) return;
  installButton.addEventListener("click", async () => {
    if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
      alert("التطبيق مثبت بالفعل على جهازك.");
      return;
    }

    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      return;
    }

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    alert(isIOS
      ? "لتثبيت الموقع على iPhone: افتحه في Safari، ثم اضغط زر المشاركة واختر «إضافة إلى الشاشة الرئيسية»."
      : "لتثبيت التطبيق: افتح الموقع في Chrome على الهاتف، ثم اضغط قائمة ⋮ واختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».");
  });
})();
