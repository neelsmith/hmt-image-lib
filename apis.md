# HMT IIIF Viewer & Utilities API Documentation

`hmt-iiif-lib.js` is a javascript library providing a lightweight, from-scratch IIIF image viewer tailored for citation by CITE2 URNs, along with utility functions for generating IIIF URLs. It is configured to work the Homer Multitext project's IIIF image server. 

It is designed to be simple and easy to use, with a focus on functionality rather than extensive features. The viewer supports basic interactions like panning and zooming, as well as the ability to draw Regions of Interest (ROIs) on images, and interpret those selections as URNs.




## Table of Contents

1.  [Installation](#installation)
2.  [Core Viewer: `HMTIIIFViewer.createViewer()`](#core-viewer-hmtiiifviewercreateviewer)
    *   [Parameters](#parameters)
    *   [Interactions](#interactions)
    *   [ROI Drawing Mode](#roi-drawing-mode)
    *   [Example Usage](#example-usage)
3.  [URL Generation: `HMTIIIFViewer.generateIIIFUrl()`](#url-generation-hmtiiifviewergenerateiiifurl)
    *   [Parameters](#parameters-1)
    *   [Return Value](#return-value)
    *   [Example Usage](#example-usage-1)
4.  [CITE2 URN Format for HMT Images](#cite2-urn-format-for-hmt-images)

## Installation

Include the `hmt-iiif-viewer.js` script in your HTML file:

```html
<script src="path/to/hmt-iiif-viewer.js"></script>
```

Or, if hosted on a CDN like jsDelivr (once you publish it to GitHub):

```html
<script src="https://cdn.jsdelivr.net/gh/neelsmith/YOUR_REPONAME@VERSION/hmt-iiif-lib.js"></script>
```

The library exposes a global object `HMTIIIFViewer`.

## Core Viewer: `HMTIIIFViewer.createViewer()`

This function creates an interactive IIIF image viewer instance within a specified DOM element. It supports panning, zooming, displaying multiple Regions of Interest (ROIs) defined in URNs, and a mode for users to draw new ROIs.

### Parameters

`HMTIIIFViewer.createViewer(elementId, urnInput, onRoiDrawnCallback)`

1.  **`elementId`** (String, Required)
    *   The `id` of the HTML `div` element where the viewer will be rendered. The viewer will clear any existing content within this element.

2.  **`urnInput`** (String | Array<String>, Required)
    *   A single CITE2 URN string or an array of CITE2 URN strings.
    *   All URNs (if an array is provided) **must** refer to the same base HMT image. They can differ by their ROI extension (e.g., `@x,y,w,h`).
    *   The first URN in the array (or the single URN if a string is passed) is used to fetch the base image information (`info.json`).
    *   ROIs specified in the URNs will be displayed as semi-opaque colored overlays on the image.
        *   Example single URN: `'urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.1,0.1,0.2,0.2'`
        *   Example array of URNs:
            ```javascript
            [
                'urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.1,0.1,0.2,0.2',
                'urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.5,0.5,0.3,0.3'
            ]
            ```

3.  **`onRoiDrawnCallback`** (Function, Optional)
    *   A callback function that is invoked when a user successfully draws a new ROI on the image using the draw mode (see below).
    *   The callback receives one argument:
        *   `roiUrnString` (String): The base URN of the displayed image, appended with the newly drawn ROI in `@x,y,w,h` format (e.g., `'urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.25,0.50,0.40,0.15'`). Coordinates are percentages (0-1).
    *   User-drawn ROIs are also immediately displayed on the viewer with a random semi-opaque color.

### Interactions

*   **Pan**: Click and drag the image with the left mouse button.
*   **Zoom**: Use the mouse wheel. Zoom is centered on the mouse cursor's position.

### ROI Drawing Mode

*   **Activate**: Hold down the **Option** key (Mac) or **Alt** key (Windows/Linux). The cursor will change to a crosshair.
*   **Draw**: While the Option/Alt key is held, click and drag on the image to draw a rectangle. A temporary dashed blue rectangle will provide visual feedback.
*   **Finalize**: Release the mouse button.
    *   The `onRoiDrawnCallback` function (if provided) will be called with the URN string of the new ROI.
    *   The newly drawn ROI will be displayed on the image with a random color and 0.5 opacity.
*   **Cancel**: Move the mouse outside the viewer area while drawing, or release the Option/Alt key before releasing the mouse button (behavior might vary slightly, but releasing the mouse button is the primary finalization step).
*   **Disabled Interactions**: Panning and zooming are disabled while the Option/Alt key is held down.

### Example Usage

**HTML:**

```html
<div id="myViewer" style="width: 600px; height: 400px; border: 1px solid black;"></div>
<textarea id="drawnRoisOutput" rows="5" cols="70" readonly placeholder="Drawn ROIs will appear here..."></textarea>
```

**JavaScript:**

```javascript
function logDrawnRoi(roiUrn) {
    const outputArea = document.getElementById('drawnRoisOutput');
    outputArea.value += roiUrn + '\n';
    console.log("New ROI Drawn:", roiUrn);
}

// Single URN with an ROI
const urn1 = 'urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.1,0.1,0.2,0.2';
HMTIIIFViewer.createViewer('myViewer', urn1, logDrawnRoi);

// Multiple URNs for the same image, different ROIs (uncomment to use)
/*
const urns = [
    'urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.1,0.1,0.2,0.2', // Reddish overlay
    'urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.5,0.5,0.3,0.3'  // Greenish overlay
];
HMTIIIFViewer.createViewer('myViewer', urns, logDrawnRoi);
*/
```

## URL Generation: `HMTIIIFViewer.generateIIIFUrl()`

This utility function constructs a complete IIIF Image API URL string based on an HMT CITE2 URN and optional sizing parameters.

### Parameters

`HMTIIIFViewer.generateIIIFUrl(urnString, options)`

1.  **`urnString`** (String, Required)
    *   The HMT CITE2 URN for the image. It can optionally include an ROI extension (e.g., `@x,y,w,h`).

2.  **`options`** (Object, Optional)
    *   An object to specify desired output dimensions.
    *   **`options.width`** (Number, Optional): Desired output width in pixels.
    *   **`options.height`** (Number, Optional): Desired output height in pixels.
    *   **Sizing Behavior**:
        *   If only `width` is provided, the IIIF size parameter will be `w,` (e.g., `800,`).
        *   If only `height` is provided, the IIIF size parameter will be `,h` (e.g., `,600`).
        *   If both `width` and `height` are provided, the IIIF size parameter will be `!w,h` (e.g., `!800,600`), causing the image to be scaled to fit *within* these dimensions while maintaining its aspect ratio.
        *   If neither `width` nor `height` is provided (or the `options` object is omitted), the IIIF size parameter will be `full`.
    *   **ROI Behavior**:
        *   If the `urnString` includes an ROI extension (e.g., `...@0.25,0.50,0.40,0.15`), the IIIF region parameter will be set to `pct:x,y,w,h` with values scaled to 0-100 (e.g., `pct:25,50,40,15`).
        *   If no ROI extension is in the URN, the IIIF region parameter will be `full`.
    *   **Other IIIF Parameters**:
        *   Rotation is fixed at `0`.
        *   Quality is fixed at `default`.
        *   Format is fixed at `jpg`.

### Return Value

*   (String): The fully constructed IIIF URL.
*   (null): If the URN is invalid or the IIIF base path cannot be constructed. An error will also be logged to the console.

### Example Usage

```javascript
const urnWithRoi = 'urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.25,0.50,0.40,0.15';
const urnWithoutRoi = 'urn:cite2:hmt:vaimg.2017a:VA012RN_0013';

// Example 1: ROI from URN, specific width
const url1 = HMTIIIFViewer.generateIIIFUrl(urnWithRoi, { width: 500 });
// Expected: .../pct:25,50,40,15/500,/0/default.jpg

// Example 2: No ROI in URN, fit within 300x300
const url2 = HMTIIIFViewer.generateIIIFUrl(urnWithoutRoi, { width: 300, height: 300 });
// Expected: .../full/!300,300/0/default.jpg

// Example 3: ROI from URN, full size
const url3 = HMTIIIFViewer.generateIIIFUrl(urnWithRoi);
// Expected: .../pct:25,50,40,15/full/0/default.jpg

// Example 4: No ROI, no specific size (full size)
const url4 = HMTIIIFViewer.generateIIIFUrl(urnWithoutRoi);
// Expected: .../full/full/0/default.jpg

console.log(url1);
document.getElementById('myImageElement').src = url2; // Display in an image tag
```

## CITE2 URN Format for HMT Images

HMT images are identified with CITE2 URNs which have 5 components separated by colons.

*   **Structure**: `urn:cite2:{namespace}:{collection_version}:{object_id}[@{roi}]`
*   **Example**: `urn:cite2:hmt:vaimg.2017a:VA012RN_0013`
    *   `namespace`: `hmt`
    *   `collection_version`: `vaimg.2017a` (parsed as collection `vaimg` and version `2017a`)
    *   `object_id`: `VA012RN_0013`
*   **Optional ROI Extension**:
    *   Appended to the `object_id` with an `@` symbol.
    *   Format: `@x,y,w,h` where `x, y, w, h` are comma-separated numbers representing percentages (0.0 to 1.0) of the image dimensions.
        *   `x`: horizontal offset of the top-left corner from the left edge.
        *   `y`: vertical offset of the top-left corner from the top edge.
        *   `w`: width of the region.
        *   `h`: height of the region.
    *   Example with ROI: `urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.25,0.50,0.40,0.15`
        *   This defines a rectangle starting at (25% X, 50% Y) with a width of 40% and a height of 15% of the total image dimensions.