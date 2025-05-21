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
        if (collectionVersion.length < 1) { // allow for no period, though example has it
             console.error("Invalid collection component in URN:", urnString);
            return null;
        }
        const collection = collectionVersion[0];
        const version = collectionVersion.length > 1 ? collectionVersion[1] : ''; // Handle cases with or without version part like '.2017a'
        
        const objectId = parts[4];

        return {
            namespace: namespace,
            collection: collection,
            version: version,
            objectId: objectId
        };
    }

    function buildIIIFImageDataBase(parsedUrn) {
        if (!parsedUrn) return null;
        // Example: /project/homer/pyramidal/deepzoom/hmt/vaimg/2017a/VA012RN_0013.tif
        let path = `${HMT_IIIF_PATH_BASE}/${parsedUrn.namespace}/${parsedUrn.collection}`;
        if (parsedUrn.version) { // Only append version if it exists
            path += `/${parsedUrn.version}`;
        }
        path += `/${parsedUrn.objectId}.tif`;
        return path;
    }

    function createViewer(elementId, cite2Urn) {
        const container = document.getElementById(elementId);
        if (!container) {
            console.error(`Element with ID '${elementId}' not found.`);
            return;
        }

        container.innerHTML = ''; // Clear previous content
        container.style.overflow = 'hidden';
        container.style.position = 'relative'; // For absolute positioning of image
        container.style.cursor = 'grab';

        const imgElement = document.createElement('img');
        imgElement.style.position = 'absolute'; // Will be positioned by renderImage
        imgElement.style.top = '0';
        imgElement.style.left = '0';
        imgElement.draggable = false; // Prevent browser's default image drag
        imgElement.alt = `IIIF image for ${cite2Urn}`;
        container.appendChild(imgElement);
        
        // Spinner
        const spinner = document.createElement('div');
        spinner.innerHTML = 'Loading...'; // Basic spinner
        spinner.style.position = 'absolute';
        spinner.style.top = '50%';
        spinner.style.left = '50%';
        spinner.style.transform = 'translate(-50%, -50%)';
        spinner.style.padding = '10px';
        spinner.style.background = 'rgba(255,255,255,0.8)';
        spinner.style.borderRadius = '5px';
        spinner.style.display = 'none'; // Hidden by default
        container.appendChild(spinner);

        let imageInfo = null; // { width, height }
        let viewportWidth = container.clientWidth;
        let viewportHeight = container.clientHeight;

        // Pan/zoom state
        let currentScale = 1.0; // screen pixels per original image pixel
        let centerXOrig = 0;    // center of view in original image coordinates
        let centerYOrig = 0;

        let isDragging = false;
        let lastMouseX = 0;
        let lastMouseY = 0;
        
        // Debounce rendering to avoid too many requests during rapid interaction
        let renderTimeout = null;
        const DEBOUNCE_DELAY = 150; // ms

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
        
        imgElement.addEventListener('load', () => spinner.style.display = 'none');
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
                // Initial view: fit image into viewport
                centerXOrig = imageInfo.width / 2;
                centerYOrig = imageInfo.height / 2;
                currentScale = Math.min(
                    viewportWidth / imageInfo.width,
                    viewportHeight / imageInfo.height
                );
                constrainState(); // Apply initial constraints
                renderImage();    // Initial render
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

        function renderImage() {
            if (!imageInfo || viewportWidth === 0 || viewportHeight === 0) return;

            // Calculate the region of the original image to fetch
            let reqWidthOrig = viewportWidth / currentScale;
            let reqHeightOrig = viewportHeight / currentScale;

            let reqXOrig = centerXOrig - reqWidthOrig / 2;
            let reqYOrig = centerYOrig - reqHeightOrig / 2;

            // Clamp region to image boundaries
            // Requested X,Y must be within [0, image.width - 1] and [0, image.height - 1]
            // Requested W,H must be > 0
            
            // Adjust X, Y if they are out of bounds, then adjust W, H if needed.
            if (reqXOrig < 0) {
                // reqWidthOrig += reqXOrig; // Effectively reduces width if part is off-screen
                reqXOrig = 0;
            }
            if (reqYOrig < 0) {
                // reqHeightOrig += reqYOrig;
                reqYOrig = 0;
            }

            // Ensure requested width/height don't exceed image dimensions from the (potentially new) X,Y
            if (reqXOrig + reqWidthOrig > imageInfo.width) {
                reqWidthOrig = imageInfo.width - reqXOrig;
            }
            if (reqYOrig + reqHeightOrig > imageInfo.height) {
                reqHeightOrig = imageInfo.height - reqYOrig;
            }
            
            // Ensure width and height are at least 1 pixel
            reqWidthOrig = Math.max(1, Math.round(reqWidthOrig));
            reqHeightOrig = Math.max(1, Math.round(reqHeightOrig));
            reqXOrig = Math.round(reqXOrig);
            reqYOrig = Math.round(reqYOrig);

            // Final check to prevent requesting beyond image boundaries if rounding caused issues
            if (reqXOrig + reqWidthOrig > imageInfo.width) reqXOrig = imageInfo.width - reqWidthOrig;
            if (reqYOrig + reqHeightOrig > imageInfo.height) reqYOrig = imageInfo.height - reqHeightOrig;
            if (reqXOrig < 0) reqXOrig = 0; // If width itself is larger than image width
            if (reqYOrig < 0) reqYOrig = 0;


            const region = `${reqXOrig},${reqYOrig},${reqWidthOrig},${reqHeightOrig}`;
            // Request size that fits the viewport. Server will maintain aspect ratio.
            const size = `!${viewportWidth},${viewportHeight}`;
            const imageUrl = `${HMT_IIIF_PROTOCOL}://${HMT_IIIF_SERVER_BASE}${iiifImageDataPath}/${region}/${size}/0/default.jpg`;
            
            imgElement.src = imageUrl;
            // The image returned by IIIF with !w,h will fit *within* w,h.
            // Style the img tag to fill the container.
            imgElement.style.width = '100%';
            imgElement.style.height = '100%';
            imgElement.style.objectFit = 'contain';
        }

        function constrainState() {
            if (!imageInfo) return;

            // Min scale: image is 1/4th the size of "fit to screen"
            // Max scale: 4 screen pixels per original image pixel (or image full res, whichever is larger for max)
            const minFitScale = Math.min(viewportWidth / imageInfo.width, viewportHeight / imageInfo.height);
            currentScale = Math.max(minFitScale / 4, currentScale);
            currentScale = Math.min(4, currentScale); // Max zoom factor of 4

            // Pan constraints
            // Effective width/height of the full image if displayed at currentScale
            const effectiveDisplayWidthAtScale = imageInfo.width * currentScale;
            const effectiveDisplayHeightAtScale = imageInfo.height * currentScale;

            // If image is smaller than viewport, center it
            if (effectiveDisplayWidthAtScale <= viewportWidth) {
                centerXOrig = imageInfo.width / 2;
            } else {
                // Min/max center X in original image coordinates
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

        function setupEventListeners() {
            // Zoom
            container.addEventListener('wheel', function(event) {
                event.preventDefault();
                const zoomFactor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
                const rect = container.getBoundingClientRect();
                const mouseXvp = event.clientX - rect.left; // mouse X relative to viewport
                const mouseYvp = event.clientY - rect.top;  // mouse Y relative to viewport

                // Point on original image under mouse before zoom
                const ptXOrig = centerXOrig + (mouseXvp - viewportWidth / 2) / currentScale;
                const ptYOrig = centerYOrig + (mouseYvp - viewportHeight / 2) / currentScale;

                const newScale = currentScale * zoomFactor;
                
                // Update currentScale first before using it in new center calculation
                currentScale = newScale;
                constrainState(); // Apply scale constraints before calculating new center

                // Recalculate center so the point under mouse stays fixed
                centerXOrig = ptXOrig - (mouseXvp - viewportWidth / 2) / currentScale;
                centerYOrig = ptYOrig - (mouseYvp - viewportHeight / 2) / currentScale;
                
                constrainState(); // Apply all constraints
                scheduleRender();
            });

            // Pan
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

                centerXOrig -= dx / currentScale;
                centerYOrig -= dy / currentScale;
                
                constrainState();
                scheduleRender();
            });

            container.addEventListener('mouseup', function(event) {
                if (event.button !== 0) return;
                if (isDragging) {
                    isDragging = false;
                    container.style.cursor = 'grab';
                    // Final render already scheduled by mousemove, or if no move, not needed.
                    // scheduleRender(); // Could ensure one final high-quality render if needed.
                }
            });

            container.addEventListener('mouseleave', function() {
                if (isDragging) {
                    isDragging = false;
                    container.style.cursor = 'grab';
                    // scheduleRender(); 
                }
            });
            
            // Handle viewport resize (basic)
            // A more robust solution would use ResizeObserver
            window.addEventListener('resize', function() {
                viewportWidth = container.clientWidth;
                viewportHeight = container.clientHeight;
                constrainState();
                scheduleRender();
            });
        }
    }

    window.HMTIIIFViewer = {
        createViewer: createViewer
    };

})(window);