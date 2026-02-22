import SwiftUI
import LvlUpKitSagaSparkPad

@main
struct SagaSparkPadApp: App {
    var body: some Scene {
        WindowGroup {
            SagaSparkPadRootView(
                config: SagaSparkPadConfig(
                    campaignID: "saga-spark-ipad",
                    userID: "ipad-local"
                )
            )
        }
    }
}
