
# HMT IIIF Library (`hmt-iiif-lib.js`) version 3.0.0: API Documentation

`hmt-iiif-lib.js` is a lightweight JavaScript library for interacting with IIIF images from the Homer Multitext Project (HMT). It provides functionality to generate IIIF Image API URLs and to create an interactive image viewer with zoom, pan, region selection, and query capabilities.

## Table of Contents

1.  [Installation](#installation)
2.  [Core Concepts](#core-concepts)
    *   [CITE2 URNs for HMT Images](#cite2-urns-for-hmt-images)
    *   [URN to IIIF Conversion](#urn-to-iiif-conversion)
    *   [Region of Interest (ROI) Extensions](#region-of-interest-roi-extensions)
3.  [Global Object: `HMTIIIF`](#global-object-hmtiiif)
4.  [API Functions](#api-functions)
    *   [`HMTIIIF.getIIIFImageUrl(urnStr, options)`](#hmtiiifgetiiifimageurlurnstr-options)
    *   [`HMTIIIF.createViewer(containerIdOrElement, urnOrUrns, viewerOptions)`](#hmtiiifcreateviewercontaineridorelement-urnorurns-vieweroptions)
5.  [Viewer Instance API](#viewer-instance-api)
    *   [`viewer.destroy()`](#viewerdestroy)
    *   [`viewer.addROI(urnWithROI)`](#vieweraddroiurnwithroi)
    *   [`viewer.removeROI(urnWithROI)`](#viewerremoveroiurnwithroi)
    *   [`viewer.getROIs()`](#viewergetrois)
6.  [Viewer Interaction Modes](#viewer-interaction-modes)

## 1. Installation

To use `hmt-iiif-lib.js` in your project via jsDelivr, include the following script tag in your HTML file. 

```html
<script src="https://cdn.jsdelivr.net/gh/neelsmith/hmt-image-lib@3.0.0/hmt-iiif-lib.js"></script>
```



## 2. Core Concepts

### CITE2 URNs for HMT Images
Images in the Homer Multitext project are identified using CITE2 URNs. These URNs have 5 components separated by colons:
`urn:cite2:{namespace}:{collection-component}:{object-identifier}`

Example: `urn:cite2:hmt:vaimg.2017a:VA012RN_0013`

*   `urn:cite2`: Standard URN prefix for CITE2.
*   `hmt`: Namespace (3rd component).
*   `vaimg.2017a`: Collection component (4th component), typically `group.version`.
*   `VA012RN_0013`: Object identifier (5th component).

### URN to IIIF Conversion
The library automatically converts HMT CITE2 URNs into the appropriate IIIF identifiers for the HMT IIIF server.
*   **Protocol:** `http`
*   **Server:** `www.homermultitext.org/iipsrv?IIIF=`
*   **IIIF Prefix Base:** `/project/homer/pyramidal/deepzoom`
*   **Construction:**
    1.  Start with the IIIF Prefix Base.
    2.  Append the URN's `namespace`.
    3.  The URN's `collection-component` is split by a period (`.`). Append the first part.
    4.  Append the second part of the `collection-component`.
    *   Example URN `urn:cite2:hmt:vaimg.2017a:VA012RN_0013` yields IIIF Prefix: `/project/homer/pyramidal/deepzoom/hmt/vaimg/2017a`
*   **Image Identifier:** Append `.tif` to the URN's `object-identifier`.
    *   Example: `VA012RN_0013.tif`
*   **Full `info.json` path example:** `http://www.homermultitext.org/iipsrv?IIIF=/project/homer/pyramidal/deepzoom/hmt/vaimg/2017a/VA012RN_0013.tif/info.json`

### Region of Interest (ROI) Extensions
URNs can include an ROI extension to specify a rectangular area on the image.
*   **Format:** `@x,y,w,h` appended to the base URN.
*   `x,y`: Coordinates of the top-left corner of the rectangle (percentages from 0.0 to 1.0).
*   `w,h`: Width and height of the rectangle (percentages from 0.0 to 1.0).
*   Example: `urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.25,0.50,0.40,0.15`

## 3. Global Object: `HMTIIIF`

After including the library, a global object `HMTIIIF` is available, which contains the public functions.

```javascript
console.log(HMTIIIF.createViewer);
console.log(HMTIIIF.getIIIFImageUrl);
```

## 4. API Functions

### `HMTIIIF.getIIIFImageUrl(urnStr, options)`

Constructs a IIIF Image API URL for a given HMT CITE2 URN.

*   **Parameters:**
    *   `urnStr` (String): The CITE2 URN for the image. This URN can optionally include an ROI extension (e.g., `@0.1,0.1,0.2,0.2`).
    *   `options` (Object, optional): An object containing options for the IIIF request.
        *   `width` (Number, optional): Desired output width in pixels. Aspect ratio is maintained.
        *   `height` (Number, optional): Desired output height in pixels. Aspect ratio is maintained.
        *   If both `width` and `height` are provided, the IIIF `!w,h` syntax is used, ensuring the image fits within these dimensions while preserving aspect ratio. The server typically scales based on the dimension that imposes the greater constraint.
        *   If only `width` is provided, IIIF `w,` syntax is used.
        *   If only `height` is provided, IIIF `,h` syntax is used.
        *   If neither `width` nor `height` is provided, the `size` parameter is set to `full`.
*   **Returns:** (String) The fully formed IIIF Image API URL for a JPG image, or `null` if the URN is invalid.
    *   If an ROI is specified in `urnStr`, the IIIF `region` parameter will be set to `pct:x,y,w,h` (values scaled 0-100).
    *   The IIIF `format` parameter is always set to `jpg`.
    *   The IIIF `rotation` parameter is always set to `0`.
    *   The IIIF `quality` parameter is always set to `default`.

*   **Example:**
    ```javascript
    const baseUrn = 'urn:cite2:hmt:vaimg.2017a:VA012RN_0013';
    const urnWithRoi = 'urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.1,0.1,0.25,0.25';

    // Get full image URL
    const fullImageUrl = HMTIIIF.getIIIFImageUrl(baseUrn);
    // console.log(fullImageUrl);
    // Expected: http://www.homermultitext.org/iipsrv?IIIF=/project/homer/pyramidal/deepzoom/hmt/vaimg/2017a/VA012RN_0013.tif/full/full/0/default.jpg

    // Get image with ROI
    const roiImageUrl = HMTIIIF.getIIIFImageUrl(urnWithRoi);
    // console.log(roiImageUrl);
    // Expected: http://www.homermultitext.org/iipsrv?IIIF=/project/homer/pyramidal/deepzoom/hmt/vaimg/2017a/VA012RN_0013.tif/pct:10,10,25,25/full/0/default.jpg

    // Get image with specified width
    const sizedImageUrl = HMTIIIF.getIIIFImageUrl(baseUrn, { width: 800 });
    // console.log(sizedImageUrl);
    // Expected: http://www.homermultitext.org/iipsrv?IIIF=/project/homer/pyramidal/deepzoom/hmt/vaimg/2017a/VA012RN_0013.tif/full/800,/0/default.jpg

    // Get image with ROI and specified max dimensions
    const sizedRoiUrl = HMTIIIF.getIIIFImageUrl(urnWithRoi, { width: 200, height: 150 });
    // console.log(sizedRoiUrl);
    // Expected: http://www.homermultitext.org/iipsrv?IIIF=/project/homer/pyramidal/deepzoom/hmt/vaimg/2017a/VA012RN_0013.tif/pct:10,10,25,25/!200,150/0/default.jpg
    ```

### `HMTIIIF.createViewer(containerIdOrElement, urnOrUrns, viewerOptions)`

Creates and initializes an interactive IIIF image viewer in the specified HTML container. The viewer supports zooming, panning, and interactions for selecting and querying regions of interest (ROIs). Multiple viewer instances can exist on a single page.

*   **Parameters:**
    *   `containerIdOrElement` (String | HTMLElement): The ID of the HTML element (e.g., a `<div>`) where the viewer canvas should be created, or a direct reference to the HTMLElement.
    *   `urnOrUrns` (String | Array<String>):
        *   If a **String**: The CITE2 URN of the image to display. This URN can include an ROI extension, which will be highlighted initially.
        *   If an **Array of Strings**:
            *   The first string in the array **must** be the base CITE2 URN for the image.
            *   Subsequent strings in the array should be URNs for the same base image but with ROI extensions (e.g., `BASE_URN@x,y,w,h`). These ROIs will be highlighted initially.
            *   All URNs in the array must refer to the same base image.
    *   `viewerOptions` (Object, optional): An object for configuring viewer callbacks.
        *   `onRectangleSelected` (Function, optional): A callback function invoked when the user draws a new rectangle (ROI) on the image.
            *   **Callback argument:** `allUrnsString` (String) - A newline-separated string containing all currently highlighted ROI URNs (including the newly added one).
        *   `onQuery` (Function, optional): A callback function invoked when the user Shift-clicks on the image.
            *   **Callback argument:** `matchingUrns` (Array<String>) - An array of URNs (with ROI extensions) for any highlighted rectangles that contain the clicked point. An empty array is passed if no rectangles match.
*   **Returns:** (Object) A viewer instance object with methods to interact with the viewer (see [Viewer Instance API](#viewer-instance-api)), or `null` if the container element is not found.

*   **Example:**
    ```html
    <div id="viewer1" style="width: 600px; height: 400px; border: 1px solid black;"></div>
    <div id="viewer2" style="width: 500px; height: 350px; border: 1px solid blue;"></div>
    <ul id="roiList"></ul>
    <div id="queryResult"></div>
    ```
    ```javascript
    // Basic viewer
    const viewer1 = HMTIIIF.createViewer('viewer1', 'urn:cite2:hmt:vaimg.2017a:VA012RN_0013');

    // Viewer with initial ROIs and callbacks
    const initialUrns = [
        'urn:cite2:hmt:vaimg.2017a:VA013RN_0014', // Base image
        'urn:cite2:hmt:vaimg.2017a:VA013RN_0014@0.1,0.1,0.2,0.2', // ROI 1
        'urn:cite2:hmt:vaimg.2017a:VA013RN_0014@0.5,0.5,0.1,0.3'  // ROI 2
    ];

    const viewer2 = HMTIIIF.createViewer(document.getElementById('viewer2'), initialUrns, {
        onRectangleSelected: function(allUrnsString) {
            console.log("Rectangles selected/updated. All URNs:\n" + allUrnsString);
            const rois = allUrnsString.split('\n').filter(urn => urn.trim() !== '');
            const roiListEl = document.getElementById('roiList');
            roiListEl.innerHTML = rois.map(urn => `<li>${urn} <button onclick="removeRoiFromViewer2('${urn}')">X</button></li>`).join('');
        },
        onQuery: function(matchingUrns) {
            const queryResultEl = document.getElementById('queryResult');
            if (matchingUrns.length > 0) {
                queryResultEl.textContent = "Clicked point is within: " + matchingUrns.join(', ');
            } else {
                queryResultEl.textContent = "Clicked point is not within any highlighted ROI.";
            }
        }
    });
    
    // Helper for the example above
    function removeRoiFromViewer2(urn) {
        if (viewer2) {
            viewer2.removeROI(urn);
            // The onRectangleSelected callback won't fire on remove, so manually update list
            const currentRois = viewer2.getROIs();
            const roiListEl = document.getElementById('roiList');
            roiListEl.innerHTML = currentRois.map(u => `<li>${u} <button onclick="removeRoiFromViewer2('${u}')">X</button></li>`).join('');
        }
    }
    ```

## 5. Viewer Instance API

The object returned by `HMTIIIF.createViewer` provides methods to programmatically interact with the viewer instance.

### `viewer.destroy()`

Removes the viewer from the DOM and cleans up associated event listeners.

*   **Parameters:** None.
*   **Returns:** `undefined`.
*   **Example:**
    ```javascript
    // Assuming 'myViewer' is an instance created by HMTIIIF.createViewer
    // myViewer.destroy();
    ```

### `viewer.addROI(urnWithROI)`

Programmatically adds a new ROI to be highlighted on the viewer.

*   **Parameters:**
    *   `urnWithROI` (String): The full CITE2 URN of the image including the ROI extension (e.g., `BASE_URN@x,y,w,h`). The base image part of this URN must match the image currently loaded in the viewer.
*   **Returns:** (Boolean) `true` if the ROI was successfully added (and was not a duplicate), `false` otherwise (e.g., invalid URN format, base URN mismatch, or duplicate).
*   **Note:** This method updates the visual display. If you need to update an external list of ROIs, you should call `viewer.getROIs()` afterwards or manage your list separately.
*   **Example:**
    ```javascript
    // const success = myViewer.addROI('urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.7,0.7,0.1,0.1');
    // if (success) console.log("ROI added programmatically.");
    ```

### `viewer.removeROI(urnWithROI)`

Programmatically removes a highlighted ROI from the viewer.

*   **Parameters:**
    *   `urnWithROI` (String): The full CITE2 URN with ROI extension of the rectangle to remove.
*   **Returns:** (Boolean) `true` if an ROI matching the URN was found and removed, `false` otherwise.
*   **Note:** This method updates the visual display.
*   **Example:**
    ```javascript
    // const removed = myViewer.removeROI('urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.7,0.7,0.1,0.1');
    // if (removed) console.log("ROI removed programmatically.");
    ```

### `viewer.getROIs()`

Retrieves a list of all currently highlighted ROI URNs in the viewer.

*   **Parameters:** None.
*   **Returns:** (Array<String>) An array of URN strings, each with an ROI extension, representing the currently highlighted rectangles.
*   **Example:**
    ```javascript
    // const currentRois = myViewer.getROIs();
    // console.log("Current ROIs:", currentRois);
    ```

## 6. Viewer Interaction Modes

The viewer supports three main interaction modes:

1.  **Standard Image Viewing (Zoom/Pan):**
    *   **Zoom:** Use the mouse wheel to zoom in and out. The zoom is centered on the mouse cursor's position.
    *   **Pan:** Click and drag the image to pan.
    *   **Cursor:** `grab` (when ready to pan), `grabbing` (while panning).

2.  **Rectangle Selection Mode:**
    *   **Activation:** Hold down the **Option (Alt)** key, then click and drag on the image.
    *   **Functionality:** Allows the user to draw a new rectangular ROI. Upon releasing the mouse button, the coordinates of the new rectangle (as a URN with ROI extension) are added to the viewer's list of highlighted ROIs. The `onRectangleSelected` callback (if provided) is invoked.
    *   **Cursor:** `crosshair`.

3.  **Query Mode:**
    *   **Activation:** Hold down the **Shift** key and click on the image.
    *   **Functionality:** Checks if the clicked point falls within any of the currently highlighted ROIs. The `onQuery` callback (if provided) is invoked with a list of URNs for all matching ROIs.
    *   **Cursor:** `help`.

Highlighted ROIs are drawn with a random semi-transparent fill color and no border. The highlights correctly scale and move with the image during zoom and pan operations. The viewer preserves the aspect ratio of the displayed image, potentially leading to letterboxing or pillarboxing within the canvas.
