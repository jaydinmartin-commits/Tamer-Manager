const Manager = globalThis.TamerManager;

if (!Manager) {
  ui.notifications.error("Tamer Manager is not initialized.");
} else {
  (async () => {
    const tamer = await Manager.chooseTamer();
    if (!tamer) return;

    const manager = new Manager({ tamer });
    await manager.render({ force: true });
  })().catch(error => {
    console.error("Tamer Manager | Failed to open manager.", error);
    ui.notifications.error("Tamer Manager could not be opened. Check the console for details.");
  });
}
