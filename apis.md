
# HMT Image Library API Documentation

## Overview

The HMT Image Library is a JavaScript library designed for interacting with images from the Homer Multitext (HMT) project via the IIIF (International Image Interoperability Framework) protocol. It allows developers to:

1.  Embed an interactive IIIF image viewer supporting panning and zooming.
2.  Enable users to select rectangular regions of interest (ROIs) on an image.
3.  Query which selected ROIs contain a specific point clicked by the user.
4.  Generate IIIF Image API URLs for HMT images, including specific regions and sizes.

The library constructs IIIF requests based on the HMT project's specific URN structure and IIIF server configuration.

## Installation / Usage

You can include this library in your HTML page directly from jsDelivr:


```html
<script src="https://cdn.jsdelivr.net/gh/neelsmith/hmt-image-lib/hmt-iiif-lib.js@2.0.0"></script>
```

Alternatively, you can download `hmt-iiif-lib.js` and host it yourself:

```html
<script src="path/to/your/hmt-iiif-lib.js"></script>
```

The library exposes a global object: `window.HMTImageLibrary`.

## Core Library Object: `HMTImageLibrary`

This is the main entry point for using the library.

### `HMTImageLibrary.createViewer(element, urn, options)`

Creates and initializes an interactive IIIF image viewer within a specified HTML element.

*   **Parameters:**
    *   `element` (String | HTMLElement): **Required**. The ID of the HTML div element that will contain the viewer, or the HTMLElement itself.
    *   `urn` (String): **Required**. The CITE2 URN identifying the HMT image (e.g., `urn:cite2:hmt:vaimg.2017a:VA012RN_0013`). The base URN (without `@` fragment) is used for image loading.
    *   `options` (Object): *Optional*. An object for configuring the viewer and its callbacks.
        *   `onRectangleSelected` (Function): *Optional*. A callback function invoked when a rectangle is drawn or removed.
            *   **Argument:** `rectURNsString` (String) - A newline-separated string of URNs for all currently selected rectangles. Each URN includes an ROI fragment (e.g., `urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.1,0.2,0.3,0.4`).
        *   `onQuery` (Function): *Optional*. A callback function invoked when the user Shift+clicks on the image.
            *   **Argument:** `matchingRectsURNs` (Array<String>) - An array of URNs (with ROI fragments) for all rectangles that contain the clicked point. An empty array is passed if no rectangles contain the point.

*   **Returns:** (HMTImageViewer | null)
    *   An instance of the `HMTImageViewer` class on success.
    *   `null` if an error occurs during initialization (an error will also be logged to the console).

*   **Example:**

    ```html
    <div id="myViewer" style="width: 600px; height: 400px; border: 1px solid black;"></div>
    <script>
        const viewerOptions = {
            onRectangleSelected: function(urns) {
                console.log("Rectangles selected/updated:\n" + urns);
                // Update your UI with this list
            },
            onQuery: function(matchingUrns) {
                if (matchingUrns.length > 0) {
                    alert("Clicked point is within:\n" + matchingUrns.join('\n'));
                } else {
                    alert("Clicked point is not within any rectangle.");
                }
            }
        };
        const viewerInstance = HMTImageLibrary.createViewer(
            'myViewer',
            'urn:cite2:hmt:vaimg.2017a:VA012RN_0013',
            viewerOptions
        );

        if (viewerInstance) {
            console.log("Viewer created successfully!");
        }
    </script>
    ```

### `HMTImageLibrary.getIIIFImageUrl(urnString, outputWidth, outputHeight)`

Generates a fully qualified IIIF Image API URL for a given HMT image URN. This function supports specifying a region of interest (ROI) via the URN fragment and can scale the image to a desired width or height while maintaining aspect ratio.

*   **Parameters:**
    *   `urnString` (String): **Required**. The CITE2 URN of the HMT image.
        *   It can be a base URN (e.g., `urn:cite2:hmt:vaimg.2017a:VA012RN_0013`).
        *   It can include an ROI fragment (e.g., `urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.25,0.50,0.40,0.15`), where `x,y,w,h` are percentages from 0 to 1.
    *   `outputWidth` (Number): *Optional*. The desired output width of the image in pixels. If provided without `outputHeight`, the image will be scaled to this width, and height will be calculated to maintain aspect ratio.
    *   `outputHeight` (Number): *Optional*. The desired output height of the image in pixels. If provided without `outputWidth`, the image will be scaled to this height, and width will be calculated to maintain aspect ratio.
    *   If both `outputWidth` and `outputHeight` are provided, the image will be scaled to fit within these dimensions while maintaining aspect ratio (IIIF `!w,h` syntax).
    *   If neither is provided, the IIIF `size` parameter will be set to `full`.

*   **Returns:** (String)
    *   A string containing the complete IIIF Image API URL.
    *   The URL will request the image in `jpg` format.
    *   If an ROI is part of the `urnString`, the IIIF `region` parameter will be set to `pct:X,Y,W,H` (where X,Y,W,H are 0-100 values derived from the URN fragment).

*   **Throws:**
    *   `Error` if the `urnString` is invalid or cannot be parsed.

*   **Example:**

    ```javascript
    // Full image URL
    const fullImageUrl = HMTImageLibrary.getIIIFImageUrl('urn:cite2:hmt:vaimg.2017a:VA012RN_0013');
    console.log(fullImageUrl);
    // Expected: http://www.homermultitext.org/iipsrv?IIIF=/project/homer/pyramidal/deepzoom/hmt/vaimg/2017a/VA012RN_0013.tif/full/full/0/default.jpg

    // Image scaled to 300px width
    const scaledWidthUrl = HMTImageLibrary.getIIIFImageUrl('urn:cite2:hmt:vaimg.2017a:VA012RN_0013', 300);
    console.log(scaledWidthUrl);
    // Expected: .../VA012RN_0013.tif/full/300,/0/default.jpg

    // Image with ROI, scaled to fit 200x150
    const roiScaledUrl = HMTImageLibrary.getIIIFImageUrl('urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.1,0.1,0.2,0.2', 200, 150);
    console.log(roiScaledUrl);
    // Expected: .../VA012RN_0013.tif/pct:10,10,20,20/!200,150/0/default.jpg
    ```

## `HMTImageViewer` Instance

An instance of `HMTImageViewer` is returned by `HMTImageLibrary.createViewer()`. It represents a single image viewer on the page and provides methods to interact with its state.

### Interaction Modes (User Input)

*   **Pan:** Click and drag the image.
*   **Zoom:** Use the mouse wheel.
*   **Select Rectangle:** Hold down `Option` (Mac) or `Alt` (Windows/Linux) key, then click and drag.
*   **Query Rectangles:** Hold down `Shift` key and click on the image.

### Methods

#### `viewerInstance.removeRectangle(rectangleURNToRemove)`

Removes a specific highlighted rectangle from the viewer's list of selected rectangles.

*   **Parameters:**
    *   `rectangleURNToRemove` (String): **Required**. The full URN of the rectangle to remove, including its `@x,y,w,h` fragment (e.g., `urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.1,0.2,0.3,0.4`). This URN should exactly match one of the URNs previously reported by the `onRectangleSelected` callback.

*   **Returns:** (Boolean)
    *   `true` if the specified rectangle was found and removed.
    *   `false` if no rectangle matching the URN was found.

*   **Side Effects:**
    *   The viewer display is updated to remove the visual highlight of the rectangle.
    *   The `onRectangleSelected` callback (if configured during viewer creation) is invoked with the updated list of rectangle URNs.

*   **Example:**

    ```javascript
    // Assuming 'viewerInstance' is an existing HMTImageViewer
    // and 'urnToRemove' is a URN obtained from the onRectangleSelected callback
    const urnToRemove = 'urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.25,0.50,0.40,0.15';
    if (viewerInstance.removeRectangle(urnToRemove)) {
        console.log(`Rectangle ${urnToRemove} removed.`);
    } else {
        console.log(`Rectangle ${urnToRemove} not found.`);
    }
    ```

#### `viewerInstance.clearAllRectangles()`

Removes all currently highlighted rectangles from the viewer.

*   **Parameters:** None.
*   **Returns:** Void.

*   **Side Effects:**
    *   The viewer display is updated to remove all visual highlights of rectangles.
    *   The `onRectangleSelected` callback (if configured) is invoked with an empty string (or no argument if no rectangles were present).

*   **Example:**

    ```javascript
    // Assuming 'viewerInstance' is an existing HMTImageViewer
    if (confirm("Are you sure you want to clear all selected regions?")) {
        viewerInstance.clearAllRectangles();
        console.log("All rectangles cleared.");
    }
    ```

## URN Structure for HMT IIIF

The library internally handles the construction of IIIF paths based on the HMT CITE2 URN structure:

*   **CITE2 URN Example:** `urn:cite2:hmt:vaimg.2017a:VA012RN_0013`
    1.  `urn`
    2.  `cite2`
    3.  `hmt` (Namespace)
    4.  `vaimg.2017a` (Collection Component: `part1.part2`)
    5.  `VA012RN_0013` (Object Identifier)

*   **IIIF Base Path:** `/project/homer/pyramidal/deepzoom`
*   **Resulting IIIF Prefix:** `/project/homer/pyramidal/deepzoom/hmt/vaimg/2017a`
*   **Image Identifier for IIIF:** `VA012RN_0013.tif`

ROI fragments are appended to the base URN with an `@` symbol, followed by four comma-separated decimal values representing x, y, width, and height as percentages (0.0 to 1.0) of the total image dimensions. Example: `@0.25,0.50,0.40,0.15`.






