// Image viewer state and commands for other C++ modules (render thread only). Owner: image-dev.
// The ui module normally talks to the viewer through the HUD model (qn::Viewer::DescribeHud /
// OnHudAction, module-contract.md §14). Use this when you need typed access, e.g. a controller
// binding that zooms or cycles the layout without going through the HUD.
#pragma once

#include <string>

#include "image/image_logic.h"

namespace qn {
namespace image {

struct ViewerState {
    bool open = false;      // a picture is open (or loading)
    bool loading = false;   // the asked-for picture is not on screen yet
    std::string name;       // file name
    std::string error;      // last error for the current picture, empty = none
    Layout layout = Layout::kMono2d;
    bool layoutFromUser = false;  // picked by the person / remembered / layoutHint
    int srcW = 0, srcH = 0;       // source pixels (after EXIF rotation)
    int texW = 0, texH = 0;       // texture on screen
    bool swapEyes = false;
    double screenScale = kDefaultScreenScale;  // flat/3D screens (1 = 6 m wide at 3 m)
    double sphereZoom = kDefaultSphereZoom;    // 180/360 magnification
    int index = -1, count = 0;    // position in the temporary folder playlist
};

class ViewerApi {
public:
    virtual ~ViewerApi() = default;
    virtual ViewerState State() const = 0;
    virtual void SetLayout(Layout layout) = 0;      // remembered per file
    virtual void CycleLayoutBy(int direction) = 0;  // +1 / -1 in LayoutOrder()
    virtual void ZoomBy(double factor) = 0;         // screen size or sphere magnification
    virtual void ResetZoom() = 0;
    virtual void Recenter() = 0;                    // put the picture in front of the current view
    virtual void SetSwapEyes(bool on) = 0;
    // Temporary: previous/next picture in the same folder. When the ui list owns navigation
    // (§14.4) the ui calls Host::OpenMedia instead and this stays unused.
    virtual bool Navigate(int direction) = 0;
};

// nullptr before OnStart and after OnStop.
ViewerApi* Api();
void SetApi(ViewerApi* api);

}  // namespace image
}  // namespace qn
