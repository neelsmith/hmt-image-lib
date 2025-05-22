# A vibe-coded javascript library for working with HMT images and IIIF

> *`hmt-iiif-lib.js` is a javascript library providing a lightweight, from-scratch IIIF image viewer tailored for citation by CITE2 URNs, along with utility functions for generating IIIF URLs. It is configured to work the Homer Multitext project's IIIF image server.*
>
>*It is designed to be simple and easy to use, with a focus on functionality rather than extensive features. The viewer supports basic interactions like panning and zooming, as well as the ability to draw Regions of Interest (ROIs) on images, interpret those selections as URNs, and query points on an image for overlap with defined ROIs.*


## Motivation

The Homer Multitext project (HMT) makes its archive of images available via the [IIIF](https://iiif.io/) protocol, but its published data releases use CITE2 URNs to provide stable references to images and regions of interest (ROIs) within those images. 

The javascript library in [hmt-iiif-lib.js](./hmt-iiif-lib.js) is designed to simplify using canonical references with the project's IIIF image server hosted on `www.homermultitext.org` in a web browser or other javascript environment. The library is fully documented in [this markdown file](./apis.md).





## Contents of this repository

In addition to the library itself (`hmt-iiif-lib.js`) and the documentation (`apis.md`), this repository includes the following web apps illustrating the library's functionality.

- `2.hmt-trimodal.html`: a simple web page illustrating the basic functionality of the interactive IIIF image viewer, including panning and zooming, drawing rectangles, and querying the image for rectangles that contain a point.
- `3.hmt-embed.html`:  a simple web page illustrating how to get an IIIF image URL for a specific an image or region of an image, using the `HMTImageLibrary.getIIIFImageURL` function.
- `4.hmt-adjacent.html`: a simple web page illustrating how to place multiple image viewers on a single page. 
- `9.hmt-ict-viz.html`: a simple web page illustrating how to interact with IIIF viewer to edit and delete ROI selections.



## Caveats and technical information

I built this library, but I don't (and won't) write javascript, so I gave in completely to what Anrej Karpathy has called [vibe coding](https://x.com/karpathy/status/1886192184808149383?lang=en). The javascript, the markdown documentation (including the quoted summary at the top of this page), and the single-page apps were all written by gemini-2.5-pro. I've made sure that the library passes a handful of sanity tests, but I have not looked at the code at all. When I ran into errors, I let gemini fix them. Use the code as you like, but be aware that I have no idea what it does or how it works.


### How I build it

If you're curious about how I built the library, the file `chat.txt` has a complete transcript of the conversation I had with gemini-2.5-pro. The `stages` directory has the functioning intermediate versions of the library. The numbers in the filenames correspond to the sequence of the library in the conversation, culminating in `hmt-iiif-lib-4.js`, which is the final version of the library, and identical to `hmt-iiif-lib.js` in this repository. 


## License

This repository is licensed under the [GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.en.html) license. You can use the code in this repository for any purpose, but you must include a copy of the GPL-3.0 license in any distribution of the code or derivative works. See the [LICENSE](./LICENSE) file for more details.