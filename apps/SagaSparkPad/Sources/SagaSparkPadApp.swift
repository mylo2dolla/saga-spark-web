import SwiftUI
import LvlUpKitSagaSparkPad

@main
struct SagaSparkPadApp: App {
    @StateObject private var model = SagaSparkPadAppModel()

    var body: some Scene {
        WindowGroup {
            SagaSparkPadRootView(model: model)
                .task {
                    await model.start()
                }
                .onOpenURL { url in
                    Task {
                        await model.handleOpenURL(url)
                    }
                }
        }
    }
}
