# Piximal 2
the successor of Piximal 1. A cellular automata of sorts, but also comparable to the ram of a modern computer. Every image has a canonical next state when passed through the piximal 2 step function (though a random image will most likely have an identical next state). The code, data, input, and output of you program are all contained in your image.
the [datasheet](https://docs.google.com/spreadsheets/d/1l8HzEkNCA6sCJ4xKUMFpFY8GZ-6lLepWTM-r2CtAgQQ/edit?usp=sharing) may come in quite handy if you plan to write programs in piximal 2, along with the pix2 assembly language.

## Layout
- the first pixel specifies the version. for piximal2 this *must* be 2, otherwise nothing will happen.
- the second pixel can be anything.
- the third pixel specifies the number of threads.
- then there are n pointers, each to a thread definition, where n is the number of threads.

## Thread Definition
- each thread definition has three pointers, one to the instruction to be executed, one to the bottom of the stack (frame), and one to the top of the stack.
- the stack bottom pointer points to the first pixel in a stack frame (not including the return address and old stack bottom pointer). It can change during a functions execution, but it must be this when the return instruction is executed
- the stack top pointer points to the pixel at the top of the stack.
- the stack bottom and top pointers may be set to 0 if you dont plan to use the stack in your program (such as push, pop, call, and return)

## Stack and Stack Frames
- each stack frame starts with 2 pointers:
 1. the pointer to the old stack bottom (where to set the stack bottom pointer after this function returns)
 3. the return address, the pointer to where execution left off when this function was called (where the instruction pointer should be when this function returns). Note that this does not point to the instruction that *called* the function, but the one after that, the one to be executed *next*.
- you can put things on the stack with push instructions, take things off the stack with pop instructions, and use dial, call, and ret instructions to use functions.
- dial prepares the next stack frame without actually calling the next function. the intended way to do a function call is to dial, then push the arguments, then call, then use the return value, then ditch twice to clean up the stack frame.
- when items are taken off the stack, nothing actually happens to them, the stack top pointer simply stops pointing to them. when the stack grows again, they are overwritten.
- you can access items going up from the stack bottom pointer with sti, and access items going down from the stack top pointer with rsti.

## Pointers
- there are two types of pointer: special and raw.
- raw pointers are simply a pixel with the index they point to.
- for huge images (more than 2^23 pixels), raw pointers will be multiple pixels long, big endian. There will be sufficiently many pixel per raw pointer such that every pixel can be represented in one less than the total available bits in that many pixels (basically you can point to any pixel on the image)
- special pointers are a single pixel with the first bit active (the red value is greater than or equal to 128). the remaining bits specify the type of special pointer. (see the data sheet)
- each pointer supports 4 operations: next index, literal, read, and write.
- next index tells you what is the index of the first pixel not consumed by the definition of this pointer (the complete definition of a pointer may be any number of pixels, this tells you where it ends)
- literal tells you exactly what the pointer is pointing *to*. for raw pointers this is just their value, but for `os` for example, it depends on the offset. some special pointers represent data that is not *in* the image. the literal value of these pointers will simply be the origin of the image.
- read returns a pixel. for raw pointers this simply returns the pixel they are pointing to, but for `wp` for example, it returns a completely white pixel, even if no such pixel exists on the actual image.
- write takes a pixel value and does something with it. for raw pointers this just writes that pixel to the place they are pointing. For special pointer that are meant to be read, writing to them will simply discard (`wp` for example)

## Pix2 Assembly
the pix2 assembly language is a simple assembly language that compiles to an image (or more specifically, it writes to an image that already exists, only overwriting what it needs to). I had to code the parser for pix2 assembly by had in a language I dont like to use, so for that reason it is very bare-bones.
- comments are either single line (`// this is a comment`) or block (`/* this is a block comment */`), just like other languages you are familiar with. comments are removed during preprocessing so block comments can literally be in the middle of a word.
- after preprocessing, the code is separated on whitespace into words.
- if the word is a non-negative number in decimal, or prefixed and in binary, hexadecimal, or octal, then it is written to the image as is. (e.x. `10`, `404`, `0b0000_1111_0000_1111`, `0xff00aa`, `0o7531`)
- if the word is a floating point number (that cant be interpreted otherwise, i.e. it must have a decimal point), then it is written to the image as the float24 representation of that number.
- if a number is bigger than 24 bits, it is drawn mod 2^24.
- if the word ends with a `:`, then it is a label. anywhere else (including before its definition) in the code where that label is used, it will be replaced with the address of that label.
- if the word *begins* with a `:`, followed by a number, then it tells the compiler to start drawing from that address. this doesnt work for labels because i dont want to figure out how to handle possible loops/self-reference.
- if the word is a mnemonic (see the datasheet), then it is replaced by the number of that instruction or special pointer.
- if the word is a label defined somewhere in the code, it represents the address of that label.

here is a simple example:
```
// single line comment
/* block
comment */
2 0 1 thread1
thread1:
ep1 0 0
result: 0
ep1:
add im 10 im 20 result
```