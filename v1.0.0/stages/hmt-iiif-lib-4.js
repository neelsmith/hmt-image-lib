(function(window) {
    'use strict';

    const HMT_IIIF_PROTOCOL = "http";
    const HMT_IIIF_SERVER_BASE = "www.homermultitext.org/iipsrv?IIIF=";
    const HMT_IIIF_PATH_BASE = "/project/homer/pyramidal/deepzoom";

    function parseCite2Urn(urnString) {
        if (typeof urnString !== 'string') return null;
        const parts = urnString.split(':');
        if (parts.length !== 5 || parts[0] !== 'urn' || parts[1] !== 'cite2') {
            console.error("Invalid CITE2 URN format:", urnString);
            return null;
        }
        const namespace = parts[2];
        const collectionVersion = parts[3].split('.');
        if (collectionVersion.length < 1) {
             console.error("Invalid collection component in URN:", urnString);
            return null;
        }
        const collection = collectionVersion[0];
        const version = collectionVersion.length > 1 ? collectionVersion[1] : '';
        
        const lastComponent = parts[4];
        const atSignIndex = lastComponent.indexOf('@');
        let objectId;
        let roi = null;

        if (atSignIndex !== -1) {
            objectId = lastComponent.substring(0, atSignIndex);
            const roiString = lastComponent.substring(atSignIndex + 1);
            const roiParts = roiString.split(',');
            if (roiParts.length === 4) {
                const [x, y, w, h] = roiParts.map(val => parseFloat(val));
                if ([x, y, w, h].every(n => !isNaN(n) && n >= 0 && n <= 1) && (w > 0) && (h > 0)) {
                    roi = { x, y, w, h };
                } else {
                    console.warn("Invalid ROI values (must be 0-1, w/h > 0) in URN, ignoring ROI:", roiString);
                }
            } else {
                console.warn("Invalid ROI component count in URN, ignoring ROI:", roiString);
            }
        } else {
            objectId = lastComponent;
        }

        return {
            namespace: namespace,
            collection: collection,
            version: version,
            objectId: objectId,
            roi: roi
        };
    }

    function buildIIIFImageDataBase(parsedUrn) {
        if (!parsedUrn) return null;
        let path = `${HMT_IIIF_PATH_BASE}/${parsedUrn.namespace}/${parsedUrn.collection}`;
        if (parsedUrn.version) {
            path += `/${parsedUrn.version}`;
        }
        path += `/${parsedUrn.objectId}.tif`;
        return path;
    }

    function createViewer(elementId, cite2Urn) {
        const container = document.getElementById(elementId);
        // ... (rest of initial setup: container, imgElement, spinner as before)
        if (!container) {
            console.error(`Element with ID '${elementId}' not found.`);
            return;
        }

        container.innerHTML = '';
        container.style.overflow = 'hidden';
        container.style.position = 'relative';
        container.style.cursor = 'grab';

        const imgElement = document.createElement('img');
        imgElement.style.position = 'absolute';
        imgElement.style.top = '0'; // These might be adjusted if using object-fit letterboxing
        imgElement.style.left = '0';
        imgElement.draggable = false;
        imgElement.alt = `IIIF image for ${cite2Urn}`;
        container.appendChild(imgElement);
        
        const spinner = document.createElement('div');
        spinner.innerHTML = 'Loading...';
        spinner.style.position = 'absolute';
        spinner.style.top = '50%';
        spinner.style.left = '50%';
        spinner.style.transform = 'translate(-50%, -50%)';
        spinner.style.padding = '10px';
        spinner.style.background = 'rgba(255,255,255,0.8)';
        spinner.style.borderRadius = '5px';
        spinner.style.display = 'none';
        container.appendChild(spinner);

        let highlightElement = null;
        let roiOrigPx = null; // ROI in original image pixel coordinates {x, y, w, h}

        let imageInfo = null;
        let viewportWidth = container.clientWidth;
        let viewportHeight = container.clientHeight;

        let currentScale = 1.0;
        let centerXOrig = 0;
        let centerYOrig = 0;

        let isDragging = false;
        let lastMouseX = 0;
        let lastMouseY = 0;
        
        let renderTimeout = null;
        const DEBOUNCE_DELAY = 150;

        // Store the region requested from IIIF for highlight calculation
        let lastRequestedRegion = { x: 0, y: 0, w: 0, h: 0 };


        const parsedUrn = parseCite2Urn(cite2Urn);
        if (!parsedUrn) {
            container.innerHTML = `<p style="color:red;">Invalid CITE2 URN: ${cite2Urn}</p>`;
            return;
        }
        const iiifImageDataPath = buildIIIFImageDataBase(parsedUrn);
        if (!iiifImageDataPath) {
             container.innerHTML = `<p style="color:red;">Could not construct IIIF path for: ${cite2Urn}</p>`;
            return;
        }
        const infoUrl = `${HMT_IIIF_PROTOCOL}://${HMT_IIIF_SERVER_BASE}${iiifImageDataPath}/info.json`;
        
        imgElement.addEventListener('load', () => {
            spinner.style.display = 'none';
            // Update highlight overlay after image has loaded and its dimensions are effectively known
            // (though IIIF size parameter !w,h should give us the info)
            updateHighlightOverlay();
        });
        imgElement.addEventListener('error', () => {
            spinner.style.display = 'none';
            container.innerHTML = `<p style="color:red;">Error loading image tile.</p>`;
        });

        spinner.style.display = 'block';
        fetch(infoUrl, { mode: 'cors' })
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error ${response.status} fetching info.json`);
                return response.json();
            })
            .then(info => {
                imageInfo = { width: info.width, height: info.height };
                centerXOrig = imageInfo.width / 2;
                centerYOrig = imageInfo.height / 2;
                currentScale = Math.min(
                    viewportWidth / imageInfo.width,
                    viewportHeight / imageInfo.height
                );

                if (parsedUrn.roi && imageInfo) {
                    highlightElement = document.createElement('div');
                    highlightElement.style.position = 'absolute';
                    highlightElement.style.border = '3px solid rgba(255, 0, 0, 0.7)';
                    highlightElement.style.backgroundColor = 'rgba(255, 0, 0, 0.05)'; // Lighter fill
                    highlightElement.style.boxSizing = 'border-box';
                    highlightElement.style.pointerEvents = 'none';
                    highlightElement.style.display = 'none';
                    container.appendChild(highlightElement);

                    roiOrigPx = {
                        x: parsedUrn.roi.x * imageInfo.width,
                        y: parsedUrn.roi.y * imageInfo.height,
                        w: parsedUrn.roi.w * imageInfo.width,
                        h: parsedUrn.roi.h * imageInfo.height
                    };
                }

                constrainState();
                renderImage();
                setupEventListeners();
            })
            .catch(error => {
                spinner.style.display = 'none';
                container.innerHTML = `<p style="color:red;">Error loading image info: ${error.message}</p>`;
                console.error("IIIF Load Error:", error);
            });

        function scheduleRender() {
            spinner.style.display = 'block';
            clearTimeout(renderTimeout);
            renderTimeout = setTimeout(renderImage, DEBOUNCE_DELAY);
        }

        function updateHighlightOverlay() {
            if (!highlightElement || !roiOrigPx || !imageInfo || viewportWidth === 0 || viewportHeight === 0 ||
                lastRequestedRegion.w <= 0 || lastRequestedRegion.h <= 0) {
                if (highlightElement) highlightElement.style.display = 'none';
                return;
            }

            const finalReqX = lastRequestedRegion.x;
            const finalReqY = lastRequestedRegion.y;
            const finalReqW = lastRequestedRegion.w;
            const finalReqH = lastRequestedRegion.h;

            // Calculate the scale factor the IIIF server uses for the !w,h request.
            // This is the scale from the requested region (finalReqW, finalReqH)
            // to the dimensions of the image content returned by the server.
            const serverScale = Math.min(viewportWidth / finalReqW, viewportHeight / finalReqH);

            // Dimensions of the actual image content rendered by the <img> tag
            // (respecting aspect ratio, potentially letterboxed/pillarboxed)
            const renderedImageContentWidth = finalReqW * serverScale;
            const renderedImageContentHeight = finalReqH * serverScale;

            // Offsets of this rendered content within the imgElement/container
            // due to object-fit: contain (or equivalent IIIF scaling)
            const contentOffsetX = (viewportWidth - renderedImageContentWidth) / 2;
            const contentOffsetY = (viewportHeight - renderedImageContentHeight) / 2;

            // ROI's top-left relative to the top-left of the requested IIIF region (finalReqX, finalReqY)
            // These are in original image pixel coordinates.
            const roiRelToRegionX_orig = roiOrigPx.x - finalReqX;
            const roiRelToRegionY_orig = roiOrigPx.y - finalReqY;

            // Position of ROI's top-left *within* the actual rendered image content on screen
            const roiInContentX_screen = roiRelToRegionX_orig * serverScale;
            const roiInContentY_screen = roiRelToRegionY_orig * serverScale;

            // Size of ROI on screen
            const roiContentWidth_screen = roiOrigPx.w * serverScale;
            const roiContentHeight_screen = roiOrigPx.h * serverScale;

            // Final position and size for the highlight div, relative to the container
            const highlightDivX = contentOffsetX + roiInContentX_screen;
            const highlightDivY = contentOffsetY + roiInContentY_screen;
            // No change to width/height calculation, it's purely scaled by serverScale
            const highlightDivW = roiContentWidth_screen;
            const highlightDivH = roiContentHeight_screen;
            
            // Hide if too small or completely off-screen (basic check)
            if (highlightDivW < 1 || highlightDivH < 1 ||
                highlightDivX + highlightDivW < 0 || highlightDivX > viewportWidth ||
                highlightDivY + highlightDivH < 0 || highlightDivY > viewportHeight) {
                highlightElement.style.display = 'none';
            } else {
                highlightElement.style.left = `${Math.round(highlightDivX)}px`;
                highlightElement.style.top = `${Math.round(highlightDivY)}px`;
                highlightElement.style.width = `${Math.round(highlightDivW)}px`;
                highlightElement.style.height = `${Math.round(highlightDivH)}px`;
                highlightElement.style.display = 'block';
            }
        }


        function renderImage() {
            if (!imageInfo || viewportWidth === 0 || viewportHeight === 0) return;

            let reqWidthOrig = viewportWidth / currentScale;
            let reqHeightOrig = viewportHeight / currentScale;
            let reqXOrig = centerXOrig - reqWidthOrig / 2;
            let reqYOrig = centerYOrig - reqHeightOrig / 2;

            // Clamp region to image boundaries
            if (reqXOrig < 0) { reqXOrig = 0; }
            if (reqYOrig < 0) { reqYOrig = 0; }

            if (reqXOrig + reqWidthOrig > imageInfo.width) {
                reqWidthOrig = imageInfo.width - reqXOrig;
            }
            if (reqYOrig + reqHeightOrig > imageInfo.height) {
                reqHeightOrig = imageInfo.height - reqYOrig;
            }
            
            reqWidthOrig = Math.max(1, Math.round(reqWidthOrig));
            reqHeightOrig = Math.max(1, Math.round(reqHeightOrig));
            reqXOrig = Math.round(reqXOrig);
            reqYOrig = Math.round(reqYOrig);

            // Final check (redundant if above logic is perfect, but safe)
            if (reqXOrig + reqWidthOrig > imageInfo.width) reqXOrig = imageInfo.width - reqWidthOrig;
            if (reqYOrig + reqHeightOrig > imageInfo.height) reqYOrig = imageInfo.height - reqHeightOrig;
            if (reqXOrig < 0) reqXOrig = 0;
            if (reqYOrig < 0) reqYOrig = 0;
             // Ensure width/height are not negative after clamping X/Y
            if (reqWidthOrig < 1) reqWidthOrig = 1;
            if (reqHeightOrig < 1) reqHeightOrig = 1;


            // Store the finally calculated region for the highlight overlay
            lastRequestedRegion = { x: reqXOrig, y: reqYOrig, w: reqWidthOrig, h: reqHeightOrig };

            const region = `${reqXOrig},${reqYOrig},${reqWidthOrig},${reqHeightOrig}`;
            const size = `!${viewportWidth},${viewportHeight}`; // Fit within, maintain aspect
            const imageUrl = `${HMT_IIIF_PROTOCOL}://${HMT_IIIF_SERVER_BASE}${iiifImageDataPath}/${region}/${size}/0/default.jpg`;
            
            imgElement.src = imageUrl;
            // The imgElement itself fills the container. object-fit handles the actual image.
            imgElement.style.width = '100%';
            imgElement.style.height = '100%';
            imgElement.style.objectFit = 'contain'; // Crucial for aspect ratio

            // Call updateHighlightOverlay here, as lastRequestedRegion is now set.
            // It's also called on imgElement.load for initial draw after image is present.
            // Calling it here ensures it updates immediately on pan/zoom logic, before image loads.
            updateHighlightOverlay();
        }

        // constrainState function remains the same
        function constrainState() {
            if (!imageInfo) return;
            const minFitScale = Math.min(viewportWidth / imageInfo.width, viewportHeight / imageInfo.height);
            currentScale = Math.max(minFitScale / 4, currentScale); // Min zoom: 1/4 of fit-to-screen
            currentScale = Math.min(4, currentScale); // Max zoom factor of 4 (screen px per orig px)

            const effectiveDisplayWidthAtScale = imageInfo.width * currentScale;
            const effectiveDisplayHeightAtScale = imageInfo.height * currentScale;

            if (effectiveDisplayWidthAtScale <= viewportWidth) {
                centerXOrig = imageInfo.width / 2;
            } else {
                const minCenterX = (viewportWidth / 2) / currentScale;
                const maxCenterX = imageInfo.width - (viewportWidth / 2) / currentScale;
                centerXOrig = Math.max(minCenterX, Math.min(maxCenterX, centerXOrig));
            }

            if (effectiveDisplayHeightAtScale <= viewportHeight) {
                centerYOrig = imageInfo.height / 2;
            } else {
                const minCenterY = (viewportHeight / 2) / currentScale;
                const maxCenterY = imageInfo.height - (viewportHeight / 2) / currentScale;
                centerYOrig = Math.max(minCenterY, Math.min(maxCenterY, centerYOrig));
            }
        }

        // setupEventListeners function remains largely the same
        function setupEventListeners() {
            container.addEventListener('wheel', function(event) {
                event.preventDefault();
                const zoomFactor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
                const rect = container.getBoundingClientRect();
                const mouseXvp = event.clientX - rect.left;
                const mouseYvp = event.clientY - rect.top;

                // Calculate the point in the original image under the mouse
                // This requires knowing the actual rendered image's offset and scale
                // For simplicity in zoom, we'll use currentScale to approximate.
                // A more precise way would use serverScale and contentOffset from updateHighlightOverlay.
                // However, currentScale should be close enough for good UX for zoom point.
                
                // Top-left of the viewport in original image coordinates (idealized)
                const idealViewOrigTopLeftX = centerXOrig - (viewportWidth / 2) / currentScale;
                const idealViewOrigTopLeftY = centerYOrig - (viewportHeight / 2) / currentScale;
                
                // Convert mouse viewport (screen) coords to original image coords
                // This step needs to account for letterboxing if we want perfect mouse point zooming.
                // For now, let's assume mouseXvp/mouseYvp are over actual image content,
                // or that currentScale is a good enough proxy for serverScale for this interaction.
                // This is a known simplification spot if zoom point feels off with letterboxing.

                // Point on original image under mouse IF image filled viewport at currentScale
                const ptXOrig = idealViewOrigTopLeftX + mouseXvp / currentScale;
                const ptYOrig = idealViewOrigTopLeftY + mouseYvp / currentScale;
                
                const oldScale = currentScale;
                currentScale *= zoomFactor;
                constrainState(); // Constrain new scale

                // Adjust centerXOrig, centerYOrig to keep ptXOrig, ptYOrig at the same mouse position
                // Recalculate new ideal top-left based on new currentScale
                const newIdealViewOrigTopLeftX = ptXOrig - (mouseXvp / currentScale);
                const newIdealViewOrigTopLeftY = ptYOrig - (mouseYvp / currentScale);

                centerXOrig = newIdealViewOrigTopLeftX + (viewportWidth / 2) / currentScale;
                centerYOrig = newIdealViewOrigTopLeftY + (viewportHeight / 2) / currentScale;
                
                constrainState(); // Apply pan constraints
                scheduleRender();
            });

            // Pan event listeners (mousedown, mousemove, mouseup, mouseleave) remain the same
            container.addEventListener('mousedown', function(event) {
                if (event.button !== 0) return; // Only left click
                isDragging = true;
                lastMouseX = event.clientX;
                lastMouseY = event.clientY;
                container.style.cursor = 'grabbing';
                event.preventDefault();
            });

            container.addEventListener('mousemove', function(event) {
                if (!isDragging) return;
                const dx = event.clientX - lastMouseX;
                const dy = event.clientY - lastMouseY;
                lastMouseX = event.clientX;
                lastMouseY = event.clientY;

                // Pan amount in original image pixels
                centerXOrig -= dx / currentScale; // Use currentScale here for panning speed
                centerYOrig -= dy / currentScale;
                
                constrainState();
                scheduleRender();
            });

            container.addEventListener('mouseup', function(event) {
                if (event.button !== 0) return;
                if (isDragging) {
                    isDragging = false;
                    container.style.cursor = 'grab';
                }
            });

            container.addEventListener('mouseleave', function() {
                if (isDragging) {
                    isDragging = false;
                    container.style.cursor = 'grab';
                }
            });
            
            // Resize listener
            window.addEventListener('resize', function() {
                // Debounce resize handling
                clearTimeout(renderTimeout); // Clear any pending image render
                renderTimeout = setTimeout(() => {
                    viewportWidth = container.clientWidth;
                    viewportHeight = container.clientHeight;
                    constrainState();
                    renderImage(); // Re-render on resize
                }, DEBOUNCE_DELAY + 50); // Slightly longer delay for resize
            });
        }
    } // End of createViewer

    window.HMTIIIFViewer = {
        createViewer: createViewer
    };

})(window);