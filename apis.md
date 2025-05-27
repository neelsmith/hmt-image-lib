
# HMT Image Library (`hmt-iiif-lib.js`) version 3.0.0 API Documentation

## Table of Contents

1.  [Overview](#overview)
2.  [Getting Started](#getting-started)
3.  [Global Library Object: `HMTImageLib`](#global-library-object-hmtimagelib)
    *   [`HMTImageLib.createViewer(elementId, urnString, viewerOptions)`](#hmtimagelibcreateviewerelementid-urnstring-vieweroptions)
    *   [`HMTImageLib.getIIIFImageUrl(urnString, options)`](#hmtimagelibgetiiifimageurlurnstring-options)
    *   [`HMTImageLib._parseURN(urnString)`](#hmtimagelib_parseurnurnstring-internaladvanced)
4.  [HMTImageViewer Instance](#hmtimageviewer-instance)
    *   [Properties (Internal)](#properties-internal)
    *   [Methods](#methods)
        *   [`viewer.setUrn(newUrnString)`](#viewerseturnnewurnstring)
        *   [`viewer.removeRectangle(urnWithRoiToRemove)`](#viewerremoverectangleurnwithroitoremove)
        *   [`viewer.destroy()`](#viewerdestroy)
5.  [Homer Multitext (HMT) CITE2 URN Format](#homer-multitext-hmt-cite2-urn-format)
6.  [Viewer Interaction Modes & Cursors](#viewer-interaction-modes--cursors)

## 1. Overview

`hmt-iiif-lib.js` is a JavaScript library for displaying and interacting with images from the Homer Multitext (HMT) project via the IIIF (International Image Interoperability Framework) protocol. It provides functionality to:

*   Create an embeddable image viewer with zoom, pan, rectangle selection, and query capabilities.
*   Generate IIIF Image API URLs for HMT images, including support for regions of interest (ROI) and image scaling.

The library is designed to be used directly in web pages and can be easily integrated using a `<script>` tag, including via services like jsDelivr.

## 2. Getting Started

1.  **Include the Library:**
    Add the library to your HTML file. If you host it on GitHub, you can use jsDelivr:

    ```html
     <script src="https://cdn.jsdelivr.net/gh/neelsmith/hmt-image-lib@3.0.0/hmt-iiif-lib.js"></script>
    <!-- Or link to a local copy -->
    <!-- <script src="hmt-iiif-lib.js"></script> -->
    ```

2.  **Create a Container for the Viewer:**
    Add an HTML element (e.g., a `div`) where the viewer will be rendered.

    ```html
    <div id="myImageViewer" style="width: 800px; height: 600px; border: 1px solid black;"></div>
    ```

3.  **Initialize the Viewer:**
    Use JavaScript to create a viewer instance.

    ```html
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const urn = "urn:cite2:hmt:vaimg.2017a:VA012RN_0013";
            const viewer = HMTImageLib.createViewer('myImageViewer', urn);
            
            // To use the URL generation function:
            const imageUrl = HMTImageLib.getIIIFImageUrl(urn, { width: 500 });
            console.log("IIIF Image URL:", imageUrl);
        });
    </script>
    ```

## 3. Global Library Object: `HMTImageLib`

The library exposes a single global object `HMTImageLib`.

### `HMTImageLib.createViewer(elementId, urnString, viewerOptions = {})`

Creates and initializes an HMT Image Viewer instance within the specified HTML element.

*   **Parameters:**
    *   `elementId` (String): The `id` of the HTML `div` (or other block element) that will contain the viewer.
    *   `urnString` (String): The CITE2 URN identifying the HMT image to display. See [HMT CITE2 URN Format](#homer-multitext-hmt-cite2-urn-format).
    *   `viewerOptions` (Object, optional): An object to configure viewer behavior.
        *   `rectangleSelectedListener` (Function, optional): A callback function invoked when a rectangle is drawn by the user or when rectangles are updated (e.g., removed).
            *   **Callback arguments:**
                1.  `urnsWithRoiString` (String): A newline-separated string of all currently highlighted rectangle URNs (e.g., `urn:...@x,y,w,h\nurn:...@x,y,w,h`).
                2.  `rectanglesArray` (Array): An array of rectangle objects. Each object has the structure:
                    ```javascript
                    {
                        x: Number, // X-coordinate of top-left corner (percentage, 0.0-1.0)
                        y: Number, // Y-coordinate of top-left corner (percentage, 0.0-1.0)
                        w: Number, // Width of rectangle (percentage, 0.0-1.0)
                        h: Number, // Height of rectangle (percentage, 0.0-1.0)
                        urnWithRoi: String, // The full URN with ROI, e.g., "urn:...@x,y,w,h"
                        color: String // CSS color string for the rectangle fill, e.g., "rgba(r,g,b,0.5)"
                    }
                    ```
        *   `queryListener` (Function, optional): A callback function invoked when the user shift-clicks on the image.
            *   **Callback arguments:**
                1.  `matchingUrnsList` (Array): An array of URN strings (with ROI) for all rectangles that contain the clicked point. An empty array `[]` is passed if no rectangles contain the point.

*   **Returns:** `(HMTImageViewer | null)`: An instance of the `HMTImageViewer` class, or `null` if initialization fails (e.g., invalid `elementId` or `urnString`). The viewer's image loading (`info.json` and initial tile) is asynchronous.

*   **Example:**
    ```javascript
    function handleRectangles(urnsString, rectsArray) {
        console.log("Selected Rectangles URNs:\n", urnsString);
        console.log("Selected Rectangles Data:", rectsArray);
        // Update UI with the list of rectangles
    }

    function handleQuery(matchedUrns) {
        if (matchedUrns.length > 0) {
            alert("Clicked in rectangles:\n" + matchedUrns.join('\n'));
        } else {
            alert("Clicked outside any rectangle.");
        }
    }

    const viewer = HMTImageLib.createViewer(
        'myViewerDiv',
        'urn:cite2:hmt:vaimg.2017a:VA012RN_0013',
        {
            rectangleSelectedListener: handleRectangles,
            queryListener: handleQuery
        }
    );
    ```

### `HMTImageLib.getIIIFImageUrl(urnString, options = {})`

Generates a IIIF Image API URL for a given HMT image URN.

*   **Parameters:**
    *   `urnString` (String): The CITE2 URN for the HMT image. This URN can optionally include a Region of Interest (ROI) suffix (e.g., `...@0.1,0.1,0.5,0.5`).
    *   `options` (Object, optional): An object to specify IIIF parameters.
        *   `width` (Number, optional): The desired width of the image in pixels. Aspect ratio is maintained.
        *   `height` (Number, optional): The desired height of the image in pixels. Aspect ratio is maintained.
        *   If both `width` and `height` are provided, the image is scaled to fit within the bounds defined by the *larger* of the two dimensions, while maintaining aspect ratio. For example, if requesting `width: 800, height: 600`, an image will be scaled such that its width is 800px (if wider than tall relative to requested aspect) or its height is 600px (if taller than wide relative to requested aspect), and the other dimension is scaled proportionally.
        *   If an ROI is specified in the `urnString`, the `pct:x,y,w,h` IIIF region parameter is used.
        *   If no size is requested, `size` is set to `full`.
        *   The `format` is always `jpg`.

*   **Returns:** `(String | null)`: The fully formed IIIF Image API URL, or `null` if the URN cannot be parsed.

*   **Example:**
    ```javascript
    const fullImageUrl = HMTImageLib.getIIIFImageUrl("urn:cite2:hmt:vaimg.2017a:VA012RN_0013");
    // Result: http://www.homermultitext.org/iipsrv?IIIF=/project/homer/pyramidal/deepzoom/hmt/vaimg/2017a/VA012RN_0013.tif/full/full/0/default.jpg

    const sizedImageUrl = HMTImageLib.getIIIFImageUrl("urn:cite2:hmt:vaimg.2017a:VA012RN_0013", { width: 300 });
    // Result: http://www.homermultitext.org/iipsrv?IIIF=/project/homer/pyramidal/deepzoom/hmt/vaimg/2017a/VA012RN_0013.tif/full/300,/0/default.jpg

    const roiImageUrl = HMTImageLib.getIIIFImageUrl("urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.25,0.5,0.4,0.15", { width: 200 });
    // Result: http://www.homermultitext.org/iipsrv?IIIF=/project/homer/pyramidal/deepzoom/hmt/vaimg/2017a/VA012RN_0013.tif/pct:25,50,40,15/200,/0/default.jpg
    ```

### `HMTImageLib._parseURN(urnString)` (Internal/Advanced)

A helper function to parse an HMT CITE2 URN string into its components. While exported, it's primarily for internal use or advanced scenarios.

*   **Parameters:**
    *   `urnString` (String): The CITE2 URN string.
*   **Returns:** `(Object | null)`: An object containing parsed URN components, or `null` if parsing fails.
    *   **Object Structure:**
        ```javascript
        {
            baseUrn: String,         // URN without ROI, e.g., "urn:cite2:hmt:vaimg.2017a:VA012RN_0013"
            namespace: String,       // e.g., "hmt"
            collectionPart1: String, // e.g., "vaimg"
            collectionPart2: String, // e.g., "2017a"
            objectId: String,        // e.g., "VA012RN_0013"
            roi: {                   // null if no ROI in URN
                x: Number,           // Percentage (0.0-1.0)
                y: Number,           // Percentage (0.0-1.0)
                w: Number,           // Percentage (0.0-1.0)
                h: Number            // Percentage (0.0-1.0)
            } | null
        }
        ```

## 4. HMTImageViewer Instance

An instance of `HMTImageViewer` is returned by `HMTImageLib.createViewer()`. It represents a single image viewer on the page.

### Properties (Internal)

The viewer instance manages internal state like current scale, view origin, loaded image data, and the list of drawn rectangles. These are generally not intended for direct manipulation.

### Methods

#### `async viewer.setUrn(newUrnString)`

Loads a new image into the viewer, replacing the current one. This clears any existing highlighted rectangles.

*   **Parameters:**
    *   `newUrnString` (String): The CITE2 URN of the new HMT image to display.
*   **Returns:** `Promise<void>`: A promise that resolves after the new image's `info.json` has been fetched and an attempt to load the initial image view has been made. It rejects if the URN is invalid.
*   **Side Effects:**
    *   Clears all previously drawn rectangles.
    *   Calls the `rectangleSelectedListener` (if provided) with empty arguments.
    *   Calls the `queryListener` (if provided) with an empty list.

#### `viewer.removeRectangle(urnWithRoiToRemove)`

Removes a specific highlighted rectangle from the viewer.

*   **Parameters:**
    *   `urnWithRoiToRemove` (String): The full URN string of the rectangle to remove, including its ROI suffix (e.g., `"urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.1,0.2,0.3,0.4"`).
*   **Returns:** `Boolean`: `true` if a rectangle with the given URN was found and removed, `false` otherwise.
*   **Side Effects:**
    *   Redraws the image without the removed rectangle.
    *   Calls the `rectangleSelectedListener` with the updated list of rectangles.

#### `viewer.destroy()`

Cleans up the viewer instance, removing its canvas from the DOM and detaching all event listeners. This should be called if the viewer is no longer needed, especially in single-page applications, to prevent memory leaks.

*   **Parameters:** None.
*   **Returns:** `void`.

## 5. Homer Multitext (HMT) CITE2 URN Format

Images are identified with CITE2 URNs, which have 5 components separated by colons:
`urn:cite2:{namespace}:{collection-version}:{object-id}`

*   **Example:** `urn:cite2:hmt:vaimg.2017a:VA012RN_0013`
    *   `namespace`: `hmt`
    *   `collection-version`: `vaimg.2017a` (parsed into `collectionPart1`="vaimg", `collectionPart2`="2017a")
    *   `object-id`: `VA012RN_0013`

**Region of Interest (ROI) Extension:**
A URN can be extended with an ROI by appending `@x,y,w,h` to the `object-id` component.
`x,y,w,h` are decimal values between 0.0 and 1.0 representing percentages of the image's total width and height.

*   `(x,y)`: Coordinates of the top-left corner of the rectangle.
*   `w`: Width of the rectangle.
*   `h`: Height of the rectangle.

*   **Example with ROI:** `urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.1,0.2,0.35,0.4`
    This represents a rectangle starting at 10% from the left and 20% from the top, with a width of 35% of the image width and a height of 40% of the image height.

## 6. Viewer Interaction Modes & Cursors

The `HMTImageViewer` supports three main interaction modes, indicated by different mouse cursors:

1.  **Standard Mode (Zoom & Pan):**
    *   **Action:**
        *   **Zoom:** Use the mouse wheel.
        *   **Pan:** Click and drag the image.
    *   **Cursor:** `grab` (becomes `grabbing` while panning).

2.  **Rectangle Selection Mode:**
    *   **Action:** Hold down the **Option (Alt)** key, then click and drag on the image to draw a rectangle.
    *   **Cursor:** `crosshair` (when Option/Alt key is pressed or during selection drag).
    *   **Result:** Drawn rectangles are filled with a random semi-transparent color. The `rectangleSelectedListener` is called.

3.  **Query Mode:**
    *   **Action:** Hold down the **Shift** key, then click on the image.
    *   **Cursor:** `help` (question mark, when Shift key is pressed).
    *   **Result:** The `queryListener` is called with a list of URNs for any highlighted rectangles that contain the clicked point.